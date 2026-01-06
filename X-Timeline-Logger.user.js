// ==UserScript==
// @name         X Timeline Logger
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @updateURL    https://github.com/sameashark/XTimelineLogger/raw/refs/heads/main/X-Timeline-Logger.user.js
// @downloadURL  https://github.com/sameashark/XTimelineLogger/raw/refs/heads/main/X-Timeline-Logger.user.js
// @description  Never miss a tweet again. Real-time logging for your X timeline. With customizable settings.
// @author       @sameashark
// @match        https://x.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- Default Configuration & Storage ---
    const DEFAULTS = {
        MAX_LOG_COUNT: 500,
        DEBOUNCE_MS: 300,
        FETCH_MODE: 'timeline',
        TRUNCATE_TEXT: 140,
        TRUNCATE_NAME: 20,
        TRUNCATE_ID: 15
    };

    const CONFIG_KEY = 'x_timeline_logger_config';
    const LOG_KEY = 'x_timeline_log';

    let CONFIG = { ...DEFAULTS };
    try {
        const saved = JSON.parse(localStorage.getItem(CONFIG_KEY));
        if (saved) CONFIG = { ...CONFIG, ...saved };
    } catch (e) { console.error('Config load failed', e); }

    // --- State Management ---
    let tweetLog = [];
    try {
        tweetLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    } catch (e) { console.error('Log load failed', e); }

    const processedTweetIds = new Set(tweetLog.map(t => t.id || t.url).filter(Boolean));
    let currentSortKey = 'fetchTime';
    let currentSortOrder = 'desc';
    let isShowMedia = true;
    let isShowRepost = true;
    let debounceTimer = null;

    // --- DOM Cache ---
    const UI = {
        modal: null,
        container: null,
        headerTitle: null,
        settingsPanel: null,
        body: null,
        count: null,
        trigger: null,
        sortBtn: null,
        btnSave: null,
        inputs: {}
    };

    // --- Utils ---
    const escapeHTML = (str) => {
        if (!str) return '';
        return str.replace(/[&<>"']/g, (m) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[m]);
    };

    const truncate = (str, len) => {
        if (!str) return '';
        return (str.length > len) ? str.substr(0, len) + '…' : str;
    };

    const getFormattedDate = (ts) => {
        const date = new Date(ts);
        if (isNaN(date.getTime())) return "00/00 00:00";
        return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    const getTextContentWithAlt = (element) => {
        if (!element) return '';
        let text = '';
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
            else if (node.tagName === 'IMG' && node.alt) text += node.alt;
        }
        return text;
    };

    const optimizeImageUrl = (url) => {
        if (!url) return '';
        return url.includes('name=') ? url.replace(/name=[a-zA-Z0-9_]+/, 'name=thumb') : url;
    };

    // --- UI Construction ---
    const style = document.createElement('style');
    style.innerHTML = `
        #tm-log-trigger {
            position: fixed; bottom: 0; left: 18px; z-index: 9999;
            width: 40px; height: 24px; background: #1d9bf0; color: white;
            padding: 0; border-radius: 4px 4px 0 0; display: flex; align-items: center; justify-content: center;
            cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.4); transition: opacity 0.2s;
        }
        #tm-log-trigger:hover { opacity: 0.8; }

        #tm-log-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); z-index: 10000; display: none;
            justify-content: center; align-items: center;
        }
        #tm-log-container {
            width: 95%; max-width: 900px; height: 85vh;
            display: flex; flex-direction: column;
            background: #15202b; color: #fff; border-radius: 8px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        /* Header */
        #tm-log-header {
            padding: 10px 15px; border-bottom: 1px solid #38444d;
            display: flex; justify-content: space-between; align-items: center;
            background: #15202b; border-radius: 8px 8px 0 0; flex-shrink: 0;
        }
        .header-title-group { display: flex; align-items: center; cursor: pointer; user-select: none; }
        .header-title-group:hover .header-title { color: #1d9bf0; }
        .header-title { font-size: 16px; font-weight: bold; margin: 0; transition: color 0.2s; }
        .header-count { font-size: 12px; color: #8899a6; margin-left: 8px; font-weight: normal; }

        /* Settings Panel */
        @keyframes accordion { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
        #tm-settings-panel {
            display: none; background: #091621; border-bottom: 1px solid #38444d; padding: 15px;
            box-shadow: inset 0 3px 5px #01090f;
            animation: accordion 0.2s ease-in forwards;
            font-size: 12px; color: #d9d9d9;
        }
        .setting-row { display: flex; align-items: flex-start; margin-bottom: 10px; flex-wrap: wrap; gap: 10px; }
        .setting-group { display: flex; flex-direction: column; gap: 4px; margin-right: 15px; }
        .setting-label { font-weight: bold; color: #8899a6; }
        .setting-desc { font-size: 10px; color: #8899a6; }

        .tm-input, .tm-select {
            background: #253341; border: 1px solid #38444d; color: #fff;
            padding: 4px 8px; border-radius: 4px; font-size: 12px;
        }
        .tm-input:focus, .tm-select:focus { outline: none; border-color: #1d9bf0; }

        .settings-actions { margin-top: 15px; padding-top: 10px; border-top: 1px solid #38444d; display: flex; justify-content: space-between; align-items: center; }

        /* Buttons */
        .tm-btn {
            background: #1d9bf0; color: #fff; border: none; padding: 4px 10px;
            border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold;
            transition: opacity 0.2s, background 0.2s; text-decoration: none;
            display: inline-flex; align-items: center; gap: 4px;
        }
        .tm-btn:hover { opacity: 0.8; }
        .tm-btn:disabled { background: #38444d; color: #8899a6; cursor: not-allowed; opacity: 1; }
        .tm-btn-red { background: #f4212e; }
        .tm-btn-outline { background: transparent; border: 1px solid #38444d; }
        .tm-icon-btn { background: none; border: none; color: #8899a6; cursor: pointer; padding: 4px; border-radius: 4px; transition: 0.2s; display: flex; }
        .tm-icon-btn:hover { background: rgba(29, 155, 240, 0.1); color: #1d9bf0; }
        .tm-icon-btn.active { color: #1d9bf0; }

        /* Body & Logs */
        #tm-log-body { flex: 1; overflow-y: auto; padding: 0; scroll-behavior: smooth; }
        #tm-log-body.hide-media .log-media-row { display: none !important; }
        #tm-log-body.hide-repost .is-repost-item { display: none !important; }

        .sort-wrapper { position: relative; display: inline-block; margin-right: 8px; }
        .sort-dropdown {
            display: none; position: absolute; top: 100%; left: 0;
            background: #192734; border: 1px solid #38444d; border-radius: 4px;
            z-index: 10001; min-width: 120px;
        }
        .sort-wrapper:hover .sort-dropdown { display: block; }
        .sort-item { padding: 8px 10px; cursor: pointer; font-size: 11px; border-bottom: 1px solid #38444d; display: block; }
        .sort-item:last-child { border-bottom: none; }
        .sort-item:hover { background: #1d9bf0; }

        @keyframes fadeInLog { from { opacity: 0.1; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
        .new-arrival { animation: fadeInLog 0.3s ease-out forwards; }

        .log-item {
            padding: 8px 10px; border-bottom: 1px solid #38444d; display: flex; gap: 10px; align-items: flex-start;
            font-size: 12px; line-height: 1.4;
        }
        .log-item:nth-child(even) { background: rgba(255,255,255,0.02); }
        .log-item:last-of-type { border-bottom: none; }
        .log-meta { width: 80px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; color: #8899a6; font-family: monospace; font-size: 11px; }
        .rt-mark { color: #00ba7c; font-weight: bold; line-height: 16px; }
        .rt-mark svg { display: inline; width: 12px; height: 12px; padding-right: 2px; vertical-align: text-bottom; }
        .attr-icons { display: flex; gap: 4px; margin-top: 2px; font-size: 12px; align-items: center; cursor: default; }
        .attr-icons svg { width: 12px; height: 12px; fill: #8899a6; }

        .log-content { flex: 1; min-width: 0; overflow-wrap: anywhere; }
        .log-user-row { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
        .log-avatar { width: 16px; height: 16px; border-radius: 50%; background: #333; }
        .log-username { color: #fff; font-weight: bold; text-decoration: none; overflow-wrap: anywhere; }
        .log-userid { color: #8899a6; text-decoration: none; overflow-wrap: anywhere; }
        .log-posttime { padding-left: 10px; color: #8899a6; text-decoration: none; white-space: nowrap; }
        .log-text { color: #d9d9d9; text-decoration: none; display: block; word-break: break-all; margin-bottom: 4px; overflow-wrap: anywhere; }
        .log-media-row { display: flex; gap: 4px; margin-top: 2px; }
        .log-thumb-wrapper { position: relative; width: 40px; height: 40px; }
        .log-thumb {
            display: block; width: 100%; height: 100%; border-radius: 4px; object-fit: cover; border: 1px solid #38444d; background-color: #000;
            transition: transform 0.2s, z-index 0.2s; cursor: zoom-in; background: #000;
        }
        .log-thumb-link { display: block; width: 100%; height: 100%; text-decoration: none; }
        .log-thumb-link:hover { z-index: 101; position: relative; opacity: 1; }
        .log-thumb-link:hover .log-thumb { transform: scale(4); position: absolute; top: 0; left: 0; border: 1px solid #fff; background-color: #000; box-shadow: 0 4px 12px rgba(0,0,0,0.8); }
        .close-btn { background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; padding: 0 5px; }
    `;
    document.head.appendChild(style);

    const trigger = document.createElement('div');
    trigger.id = 'tm-log-trigger';
    trigger.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>';
    document.body.appendChild(trigger);

    const modal = document.createElement('div');
    modal.id = 'tm-log-modal';
    modal.innerHTML = `
        <div id="tm-log-container">
            <div id="tm-log-header">
                <div class="header-title-group" id="header-title-clickable" title="トップへ戻る">
                    <h3 class="header-title">Timeline History</h3>
                    <span id="log-count" class="header-count">(0/0件)</span>
                </div>
                <div style="display:flex; align-items:center;">
                    <label class="tm-btn tm-btn-outline" style="margin-right:8px; cursor:pointer; user-select:none;">
                        <input type="checkbox" id="check-repost" checked style="cursor:pointer;"> Repost
                    </label>
                    <label class="tm-btn tm-btn-outline" style="margin-right:8px; cursor:pointer; user-select:none;">
                        <input type="checkbox" id="check-media" checked style="cursor:pointer;"> 画像
                    </label>
                    <div class="sort-wrapper">
                        <button id="main-sort-btn" class="tm-btn">並べ替え: 取得時間 ▼</button>
                        <div class="sort-dropdown">
                            <div class="sort-item" data-key="fetchTime">取得時間順</div>
                            <div class="sort-item" data-key="postTime">投稿時間順</div>
                        </div>
                    </div>

                    <button id="btn-settings" class="tm-icon-btn" title="設定" style="margin-right:5px; margin-left:5px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                    <button id="btn-close" class="close-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
                </div>
            </div>

            <div id="tm-settings-panel">
                <div class="setting-row">
                    <div class="setting-group">
                        <label class="setting-label">最大保持件数</label>
                        <input type="number" id="inp-max-count" class="tm-input" style="width:70px;" min="10" max="2000">
                        <span class="setting-desc">最低10 / 最大2000<br>多すぎると重くなります</span>
                    </div>
                    <div class="setting-group">
                        <label class="setting-label">監視間隔 (ms)</label>
                        <input type="number" id="inp-debounce" class="tm-input" style="width:70px;">
                        <span class="setting-desc">300ms以上推奨<br>短すぎると重くなります</span>
                    </div>
                    <div class="setting-group">
                        <label class="setting-label">Post表示文字数</label>
                        <input type="number" id="inp-truncate" class="tm-input" style="width:70px;">
                    </div>
                    <div class="setting-group">
                        <label class="setting-label">取得対象</label>
                        <select id="sel-fetch-mode" class="tm-select">
                            <option value="timeline">Timeline Only</option>
                            <option value="all">All Posts</option>
                        </select>
                        <span class="setting-desc" id="desc-fetch-mode">タイムラインのみ取得</span>
                    </div>
                </div>
                <div class="settings-actions">
                    <button id="btn-clear" class="tm-btn tm-btn-red">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>ログを全消去</button>
                    <button id="btn-save-settings" class="tm-btn" disabled>変更を保存</button>
                </div>
            </div>

            <div id="tm-log-body"></div>
        </div>
    `;
    document.body.appendChild(modal);

    // --- Element Binding ---
    UI.modal = modal;
    UI.container = document.getElementById('tm-log-container');
    UI.body = document.getElementById('tm-log-body');
    UI.count = document.getElementById('log-count');
    UI.headerTitle = document.getElementById('header-title-clickable');
    UI.trigger = trigger;
    UI.sortBtn = document.getElementById('main-sort-btn');
    UI.settingsPanel = document.getElementById('tm-settings-panel');
    UI.btnSettings = document.getElementById('btn-settings');
    UI.btnSave = document.getElementById('btn-save-settings');

    // Inputs
    UI.inputs.maxCount = document.getElementById('inp-max-count');
    UI.inputs.debounce = document.getElementById('inp-debounce');
    UI.inputs.truncate = document.getElementById('inp-truncate');
    UI.inputs.fetchMode = document.getElementById('sel-fetch-mode');

    // --- Logic Implementation ---
    const createLogItem = (t, animate = false) => {
        const div = document.createElement('div');
        div.className = 'log-item';
        if (animate) div.classList.add('new-arrival');
        if (t.isRT) div.classList.add('is-repost-item');

        const timeDisplay = currentSortKey === 'fetchTime' ? t.fetchTimeStr : t.postTimeStr;
        const rtLabel = t.isRT ? '<span class="rt-mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><path fill="#00ba7c" d="M30.2 10L23 4v4h-8C9.477 8 5 12.477 5 18c0 1.414.297 2.758.827 3.978l3.3-2.75C9.044 18.831 9 18.421 9 18c0-3.314 2.686-6 6-6h8v4l7.2-6zm-.026 4.023l-3.301 2.75c.083.396.127.806.127 1.227 0 3.313-2.687 6-6 6h-8v-4l-7.2 6 7.2 6v-4h8c5.522 0 10-4.478 10-10 0-1.414-.297-2.758-.826-3.977z"/></svg>Repost</span>' : '';

        const hasLink = t.hasExternalLink;
        const attrIconsHtml = `
            <div class="attr-icons">
                ${t.isQuote ? '<span title="引用RP有り"><svg viewBox="0 0 24 24"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg></span>' : ''}
                ${t.media?.length ? '<span title="画像有り">🖼️</span>' : ''}
                ${hasLink ? '<span title="リンク有り">🔗</span>' : ''}
            </div>`;

        div.innerHTML = `
            <div class="log-meta">
                <span>${escapeHTML(timeDisplay)}</span>
                ${rtLabel}
                ${attrIconsHtml}
            </div>
            <div class="log-content">
                <div class="log-user-row">
                    <img src="${escapeHTML(t.avatar)}" class="log-avatar" onerror="this.style.display='none'">
                    <a href="https://x.com/${escapeHTML(t.userId)}" target="_blank" class="log-username">${escapeHTML(truncate(t.userName, CONFIG.TRUNCATE_NAME))}</a>
                    <a href="https://x.com/${escapeHTML(t.userId)}" target="_blank" class="log-userid">@${escapeHTML(truncate(t.userId, CONFIG.TRUNCATE_ID))}</a>
                    <a href="${escapeHTML(t.url)}" target="_blank" class="log-posttime">${escapeHTML(t.postTimeStr)}</a>
                </div>
                <a href="${escapeHTML(t.url)}" target="_blank" class="log-text">${escapeHTML(truncate(t.text, CONFIG.TRUNCATE_TEXT) || '(no text)')}</a>
                ${t.media?.length ? `<div class="log-media-row">${t.media.map(u => `<div class="log-thumb-wrapper"><a href="${escapeHTML(t.url)}" target="_blank" class="log-thumb-link"><img src="${escapeHTML(optimizeImageUrl(u))}" class="log-thumb" loading="lazy"></a></div>`).join('')}</div>` : ''}
            </div>`;
        return div;
    };

    const updateCountLabel = () => { UI.count.innerText = `(${tweetLog.length}/${CONFIG.MAX_LOG_COUNT}件)`; };

    const renderFullLog = () => {
        isShowMedia ? UI.body.classList.remove('hide-media') : UI.body.classList.add('hide-media');
        isShowRepost ? UI.body.classList.remove('hide-repost') : UI.body.classList.add('hide-repost');

        const sorted = [...tweetLog].sort((a, b) => {
            const vA = a[currentSortKey] || 0; const vB = b[currentSortKey] || 0;
            return currentSortOrder === 'desc' ? (vB - vA) : (vA - vB);
        });
        const fragment = document.createDocumentFragment();
        sorted.forEach(t => fragment.appendChild(createLogItem(t)));
        UI.body.innerHTML = '';
        UI.body.appendChild(fragment);
        updateCountLabel();
        UI.sortBtn.innerText = `並べ替え: ${currentSortKey === 'fetchTime' ? '取得時間' : '投稿時間'} ${currentSortOrder === 'desc' ? '▼' : '▲'}`;
    };

    const saveTweet = (data) => {
        const key = data.id || data.url;
        if (processedTweetIds.has(key)) return false;
        processedTweetIds.add(key);
        tweetLog.unshift(data);

        if (tweetLog.length > CONFIG.MAX_LOG_COUNT) {
            const rm = tweetLog.pop();
            if (rm) processedTweetIds.delete(rm.id || rm.url);
        }

        localStorage.setItem(LOG_KEY, JSON.stringify(tweetLog));
        return true;
    };

    const processTimeline = () => {
        if (CONFIG.FETCH_MODE === 'timeline' && window.location.pathname !== '/home') return;

        const root = document.querySelector('main') || document;
        const articles = root.querySelectorAll('article[data-testid="tweet"]:not([data-tm-processed])');

        Array.from(articles).reverse().forEach(article => {
            article.setAttribute('data-tm-processed', 'true');
            try {
                const timeElem = article.querySelector('time');
                const linkElem = article.querySelector('a[href*="/status/"]');
                const userContainer = article.querySelector('[data-testid="User-Name"]');
                if (!userContainer || !linkElem) return;
                const url = linkElem.href.split('?')[0];
                const text = getTextContentWithAlt(article.querySelector('[data-testid="tweetText"]')).replace(/\n/g, ' ');
                const media = Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img')).map(i => i.src);
                const now = new Date();
                const postDate = timeElem ? new Date(timeElem.getAttribute('datetime')) : now;

                const hasCard = !!article.querySelector('[data-testid="card.wrapper"]');
                const hasExternalLink = (text && (text.includes('http://') || text.includes('https://'))) || hasCard;

                const isQuote = !!article.querySelector('div[role="link"][tabindex="0"]');

                const data = {
                    id: url.split('/').pop(), url, fetchTime: now.getTime(), fetchTimeStr: getFormattedDate(now),
                    postTime: postDate.getTime(), postTimeStr: getFormattedDate(postDate),
                    userName: userContainer.textContent.split('@')[0].trim(),
                    userId: userContainer.textContent.split('@')[1]?.split('·')[0].trim() || 'unknown',
                    text, avatar: article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.src || '',
                    media, isRT: !!article.querySelector('[data-testid="socialContext"]'),
                    isQuote,
                    hasExternalLink
                };
                if (saveTweet(data) && UI.modal.style.display === 'flex') {
                    if (currentSortKey === 'fetchTime' && currentSortOrder === 'desc') {
                        UI.body.prepend(createLogItem(data, true));
                        if (UI.body.children.length > CONFIG.MAX_LOG_COUNT) UI.body.lastElementChild.remove();
                        updateCountLabel();
                    } else {
                        renderFullLog();
                    }
                }
            } catch(e) { console.error('Capture error', e); }
        });
    };

    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => requestAnimationFrame(processTimeline), CONFIG.DEBOUNCE_MS);
    });

    // --- Settings & Events ---
    const checkDirty = () => {
        UI.btnSave.disabled = (
            parseInt(UI.inputs.maxCount.value) === CONFIG.MAX_LOG_COUNT &&
            parseInt(UI.inputs.debounce.value) === CONFIG.DEBOUNCE_MS &&
            parseInt(UI.inputs.truncate.value) === CONFIG.TRUNCATE_TEXT &&
            UI.inputs.fetchMode.value === CONFIG.FETCH_MODE
        );
    };

    UI.btnSave.onclick = () => {
        CONFIG.MAX_LOG_COUNT = Math.min(2000, Math.max(10, parseInt(UI.inputs.maxCount.value)));
        CONFIG.DEBOUNCE_MS = Math.max(100, parseInt(UI.inputs.debounce.value));
        CONFIG.TRUNCATE_TEXT = Math.max(0, parseInt(UI.inputs.truncate.value));
        CONFIG.FETCH_MODE = UI.inputs.fetchMode.value;
        localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG));

        if (tweetLog.length > CONFIG.MAX_LOG_COUNT) {
            const removed = tweetLog.slice(CONFIG.MAX_LOG_COUNT);
            removed.forEach(t => processedTweetIds.delete(t.id || t.url));
            tweetLog = tweetLog.slice(0, CONFIG.MAX_LOG_COUNT);
            localStorage.setItem(LOG_KEY, JSON.stringify(tweetLog));
        }
        renderFullLog();
        UI.settingsPanel.style.display = 'none';
        UI.btnSettings.classList.remove('active');
    };

    UI.btnSettings.onclick = () => {
        if (UI.settingsPanel.style.display === 'none' || !UI.settingsPanel.style.display) {
            UI.inputs.maxCount.value = CONFIG.MAX_LOG_COUNT;
            UI.inputs.debounce.value = CONFIG.DEBOUNCE_MS;
            UI.inputs.truncate.value = CONFIG.TRUNCATE_TEXT;
            UI.inputs.fetchMode.value = CONFIG.FETCH_MODE;
            document.getElementById('desc-fetch-mode').innerText = CONFIG.FETCH_MODE === 'timeline' ? 'タイムラインのみ取得' : '全て取得';
            UI.settingsPanel.style.display = 'block';
            UI.btnSettings.classList.add('active');
            checkDirty();
        } else {
            UI.settingsPanel.style.display = 'none';
            UI.btnSettings.classList.remove('active');
        }
    };


    UI.trigger.onclick = () => { renderFullLog(); UI.modal.style.display = 'flex'; };
    document.getElementById('btn-close').onclick = () => { UI.modal.style.display = 'none'; };

    UI.modal.onclick = (e) => { if (e.target === UI.modal) UI.modal.style.display = 'none'; };

    UI.headerTitle.onclick = () => { UI.body.scrollTop = 0; };

    document.getElementById('check-repost').onchange = (e) => { isShowRepost = e.target.checked; renderFullLog(); };
    document.getElementById('check-media').onchange = (e) => { isShowMedia = e.target.checked; renderFullLog(); };

    UI.sortBtn.onclick = (e) => { e.stopPropagation(); currentSortOrder = currentSortOrder === 'desc' ? 'asc' : 'desc'; renderFullLog(); };
    document.querySelectorAll('.sort-item').forEach(i => {
        i.onclick = (e) => {
            e.stopPropagation();
            currentSortKey = e.target.dataset.key;
            currentSortOrder = 'desc';
            renderFullLog();
        };
    });
    document.getElementById('btn-clear').onclick = () => {
        if(confirm('ログを全消去しますか？')) {
            tweetLog=[];
            processedTweetIds.clear();
            localStorage.removeItem(LOG_KEY);
            renderFullLog();
        }
    };
    [UI.inputs.maxCount, UI.inputs.debounce, UI.inputs.truncate].forEach(el => {
        el.oninput = checkDirty;
    });
    UI.inputs.fetchMode.onchange = () => {
        document.getElementById('desc-fetch-mode').innerText = UI.inputs.fetchMode.value === 'timeline' ? 'タイムラインのみ取得' : '全て取得';
        checkDirty();
    };

    observer.observe(document.body, { childList: true, subtree: true });
})();