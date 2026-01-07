// ==UserScript==
// @name         X Timeline Logger
// @namespace    http://tampermonkey.net/
// @version      2.0
// @updateURL    https://github.com/sameashark/XTimelineLogger/raw/refs/heads/main/X-Timeline-Logger.user.js
// @downloadURL  https://github.com/sameashark/XTimelineLogger/raw/refs/heads/main/X-Timeline-Logger.user.js
// @description  Never miss a tweet again. Real-time logging for your X timeline. With customizable settings.
// @author       @sameashark
// @match        https://x.com/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // --- Default Configuration & Storage ---
    const DEFAULTS = {
        MAX_LOG_COUNT: 500,
        DEBOUNCE_MS: 300,
        FETCH_MODE: 'timeline',
        TRUNCATE_TEXT: 140,
        TRUNCATE_NAME: 20,
        TRUNCATE_ID: 15,
        IMAGE_ONLY_MODE: false, // Now acts as a Fetch Filter
        TILE_SIZE: 4,
        VIEW_MODE: 'list' // 'list' or 'tile'
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
        inputs: {},
        // New Controls
        btnDisplay: null,
        selTileSizeNew: null,
        checkRepostNew: null,
        checkMediaNew: null,
        radViewModes: []
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
        #tm-log-trigger.imgonlymode { background: #24bf74; }

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

        /* Icon Groups */
        .header-controls { display: flex; align-items: center; gap: 12px; }
        .tm-icon-group { display: flex; align-items: center; background: #253341; border-radius: 4px; border: 1px solid #38444d; overflow: hidden; }
        .tm-toggle-btn {
            background: transparent; border: none; color: #8899a6; padding: 4px 8px; cursor: pointer;
            display: flex; align-items: center; justify-content: center; height: 26px; transition: 0.2s;
        }
        .tm-toggle-btn:hover { background: rgba(255,255,255,0.05); color: #fff; }
        .tm-toggle-btn.active { background: #1d9bf0; color: #fff; }
        .tm-toggle-btn.active:hover { opacity: 0.8; }
        .tl-view .tm-toggle-btn.active:hover { opacity: 1; }
        .tm-toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .tm-toggle-btn:disabled:hover { opacity: 0.5; }

        /* Select inside group */
        .tm-group-select {
            background: #15202b; color: #fff; border: none; font-size: 11px; height: 26px;
            padding: 0 4px; border-left: 1px solid #38444d; outline: none; cursor: pointer;
        }
        .tm-group-select:focus { background: #000; }
        .tm-group-select:disabled { opacity: 0.5; cursor: not-allowed; }

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

        .imgonlymode-panel { margin-top: 15px; padding-top: 10px; border-top: 1px solid #38444d; display:flex; align-items:center; justify-content:space-between; }
        .imgonlymode-toggle { font-weight: bold; color: #24bf74; }

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
        .tm-icon-btn:hover { opacity: 0.8; }
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
        .close-btn:hover { opacity: 0.8; }

        /* Image Only & Tile Styles */
        .tgl-wrapper { display: flex; align-items: center; cursor: pointer; user-select: none; }
        .tgl-input { display: none; }
        .imgonlymode-label { margin-right: 8px; font-weight: bold; color: #fff; font-size: 13px; }
        .tgl-btn-style {
            margin-top: 2px; width: 36px; height: 20px; background: #38444d; border-radius: 9999px; position: relative; transition: background 0.2s;
        }
        .tgl-btn-style { cursor: pointer; }
        .tgl-btn-style::after {
            content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: transform 0.2s;
        }
        .tgl-input:checked + .tgl-btn-style { background: #24bf74; }
        .tgl-input:checked + .tgl-btn-style::after { transform: translateX(16px); }
        .tgl-label { margin-left: 8px; font-weight: bold; color: #fff; font-size: 13px; }

        #tm-log-body.tile-view {
            display: grid;
            grid-template-columns: repeat(var(--tile-cols, 4), 1fr);
            gap: 2px;
            padding: 2px;
            align-content: start;
        }
        .tile-item {
            width: 100%; padding-bottom: 100%; height: 0; position: relative; overflow: hidden; cursor: pointer; background: #000;
        }
        .tile-img {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; transition: transform 0.2s; display: block;
        }
        .play-icon {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 32px; height: 32px; background: rgba(0,0,0,0.5); border-radius: 50%;
            display: flex; align-items: center; justify-content: center; pointer-events: none;
        }
        .play-icon svg { width: 16px; height: 16px; fill: white; margin-left: 2px; }
        .tile-item:hover .tile-img { transform: scale(1.05); }

        /* Custom Image Viewer Modal */
        #tm-image-viewer {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,1); z-index: 10002; display: none;
            flex-direction: column;
        }
        .tv-main { flex: 1; display: flex; position: relative; overflow: hidden; }
        .tv-img-container { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; }
        .tv-img-link { display: contents; text-decoration: none; }
        .tv-img { display: block; max-width: 100%; max-height: 100%; object-fit: scale-down; }
        .tv-play-icon {
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 64px; height: 64px; background: rgba(0,0,0,0.5); border-radius: 50%;
            display: flex; align-items: center; justify-content: center; pointer-events: none;
            z-index: 10;
        }
        .tv-play-icon svg { width: 32px; height: 32px; fill: white; margin-left: 4px; }
        .tv-nav-btn {
            position: absolute; top: 50%; transform: translateY(-50%);
            background: rgba(255, 255, 255, 0.1); border: none; color: #fff;
            width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: background 0.2s; z-index: 10;
            box-shadow: 0 0 4px rgba(14, 14, 14, 0.2);
        }
        .tv-nav-btn svg { filter: drop-shadow(0 0 2px #000); opacity: 0.4; }
        .tv-nav-btn:hover { background: rgba(255, 255, 255, 0.5); }
        .tv-nav-prev { left: 20px; }
        .tv-nav-next { right: 20px; }

        .tv-meta-panel {
            background: #000; border-top: 1px solid #333; padding: 12px;
            display: flex; gap: 12px; color: #fff; font-size: 11px; flex-shrink: 0;
        }
        .tv-meta-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .tv-row-user { display: flex; align-items: center; gap: 8px; }
        .tv-avatar { width: 20px; height: 20px; border-radius: 50%; }
        .tv-username { font-weight: bold; color: #e7e9ea; text-decoration: none; }
        .tv-userid { color: #71767b; text-decoration: none; }
        .tv-time { color: #71767b; margin-left: auto; text-decoration: none; }
        .tv-text {
            color: #e7e9ea; line-height: 1.4; word-break: break-word; white-space: pre-wrap;
            max-height: 60px; overflow-y: auto; text-decoration: none; display: block;
        }
        .tv-text:hover { text-decoration: underline; }
        .tv-close {
            position: absolute; top: 10px; right: 20px;
            background: rgba(0,0,0,0.5); border-radius: 50%; padding: 8px;
            cursor: pointer; color: #fff; border: none; display: flex; z-index: 20;
        }
        .tv-close:hover { opacity: 0.8; }
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

                <div class="header-controls">
                    <!-- Filter Group -->
                    <div class="tm-icon-group">
                        <button id="btn-toggle-repost" class="tm-toggle-btn active" title="Repost表示切り替え">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                        </button>
                        <button id="btn-toggle-media" class="tm-toggle-btn active" title="メディア表示切り替え">
                            <span style="font-size:16px; line-height:1;">🖼️</span>
                        </button>
                    </div>
                    <!-- View Mode Group -->
                    <div class="tm-icon-group tl-view">
                        <button id="btn-view-list" class="tm-toggle-btn active" title="リスト表示">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                        </button>
                        <button id="btn-view-tile" class="tm-toggle-btn" title="タイル表示">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                        </button>
                        <select id="sel-tile-size-new" class="tm-group-select" title="タイルサイズ">
                            <option value="4">4</option>
                            <option value="8">8</option>
                            <option value="12">12</option>
                        </select>
                    </div>

                    <!-- Sort -->
                    <div class="sort-wrapper">
                        <button id="main-sort-btn" class="tm-btn">並べ替え ▼</button>
                        <div class="sort-dropdown">
                            <div class="sort-item" data-key="fetchTime">取得時間順</div>
                            <div class="sort-item" data-key="postTime">投稿時間順</div>
                        </div>
                    </div>

                    <button id="btn-settings" class="tm-icon-btn" title="設定">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                    <button id="btn-close" class="close-btn" title="閉じる"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
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

                    <div class="setting-group">
                        <label class="setting-label">画像のみ取得
                        <input type="checkbox" id="chk-img-only" class="tgl-input">
                        <div class="tgl-btn-style"></div>
                        </label>
                        <span class="setting-desc" id="desc-img-only">画像を含むポストのみを取得します。</span>
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

    const imageViewer = document.createElement('div');
    imageViewer.id = 'tm-image-viewer';
    imageViewer.innerHTML = `
        <button class="tv-close"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        <button class="tv-nav-btn tv-nav-prev"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
        <div class="tv-main">
            <div class="tv-img-container">
                <a href="#" class="tv-img-link" target="_blank" rel="noopener">
                    <img src="" class="tv-img">
                </a>
                <div class="tv-play-icon" style="display:none">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
                </div>
            </div>
        </div>
        <button class="tv-nav-btn tv-nav-next"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
        <div class="tv-meta-panel">
            <img src="" class="tv-avatar">
            <div class="tv-meta-content">
                <div class="tv-row-user">
                    <a href="#" target="_blank" class="tv-username"></a>
                    <a href="#" target="_blank" class="tv-userid"></a>
                    <a href="#" target="_blank" class="tv-time"></a>
                </div>
                <a href="#" target="_blank" class="tv-text"></a>
            </div>
        </div>
    `;
    document.body.appendChild(imageViewer);

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

    // New Bindings
    UI.btnViewList = document.getElementById('btn-view-list');
    UI.btnViewTile = document.getElementById('btn-view-tile');
    UI.selTileSize = document.getElementById('sel-tile-size-new');
    UI.btnToggleRepost = document.getElementById('btn-toggle-repost');
    UI.btnToggleMedia = document.getElementById('btn-toggle-media');

    UI.imageViewer = imageViewer;

    // Inputs
    UI.inputs.maxCount = document.getElementById('inp-max-count');
    UI.inputs.debounce = document.getElementById('inp-debounce');
    UI.inputs.truncate = document.getElementById('inp-truncate');
    UI.inputs.fetchMode = document.getElementById('sel-fetch-mode');
    UI.inputs.imgOnlyMode = document.getElementById('chk-img-only');

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
                ${t.media?.length ? `<div class="log-media-row">${t.media.map(m => {
            const url = (typeof m === 'string') ? m : m.url;
            return `<div class="log-thumb-wrapper"><a href="${escapeHTML(t.url)}" target="_blank" class="log-thumb-link"><img src="${escapeHTML(optimizeImageUrl(url))}" class="log-thumb" loading="lazy"></a></div>`;
        }).join('')}</div>` : ''}
            </div>`;
        return div;
    };

    const createTileItem = (t, imgIndex) => {
        const div = document.createElement('div');
        div.className = 'tile-item';
        div.title = `${t.userName} (@${t.userId}) - ${t.postTimeStr}`;

        const m = t.media[imgIndex];
        const url = (typeof m === 'string') ? m : m.url;
        const isVideo = (typeof m === 'object' && m.type === 'video');

        let html = `<img src="${optimizeImageUrl(url)}" class="tile-img" loading="lazy">`;
        if (isVideo) {
            html += `
            <div class="play-icon">
                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>
            </div>`;
        }
        div.innerHTML = html;
        div.onclick = () => openImageModal(t, imgIndex);
        return div;
    };

    let flatImageList = [];
    let currentImageIndex = 0;

    const openImageModal = (targetTweet, targetImgIndex) => {
        const sorted = [...tweetLog].sort((a, b) => {
            const vA = a[currentSortKey] || 0; const vB = b[currentSortKey] || 0;
            return currentSortOrder === 'desc' ? (vB - vA) : (vA - vB);
        });

        flatImageList = [];
        let targetListIndex = 0;

        sorted.forEach(t => {
            if (t.media && t.media.length) {
                t.media.forEach((m, idx) => {
                    if (t.id === targetTweet.id && idx === targetImgIndex) {
                        targetListIndex = flatImageList.length;
                    }
                    flatImageList.push({ tweet: t, mediaItem: m, imgIndex: idx });
                });
            }
        });

        if (flatImageList.length === 0) return;
        currentImageIndex = targetListIndex;
        updateImageViewer();
        UI.imageViewer.style.display = 'flex';
    };

    const updateImageViewer = () => {
        const item = flatImageList[currentImageIndex];
        if (!item) return;
        const t = item.tweet;
        const m = item.mediaItem;
        const url = (typeof m === 'string') ? m : m.url;
        const isVideo = (typeof m === 'object' && m.type === 'video');

        const largeUrl = url.includes('name=') ? url.replace(/name=[a-zA-Z0-9_]+/, 'name=large') : `${url}?name=large`;

        const viewer = UI.imageViewer;
        const imgLink = viewer.querySelector('.tv-img-link');
        imgLink.href = t.url;
        viewer.querySelector('.tv-img').src = largeUrl;

        const playIcon = viewer.querySelector('.tv-play-icon');
        if (playIcon) playIcon.style.display = isVideo ? 'flex' : 'none';

        viewer.querySelector('.tv-avatar').src = t.avatar;
        const uLink = viewer.querySelector('.tv-username');
        uLink.textContent = t.userName; uLink.href = `https://x.com/${t.userId}`;
        const iLink = viewer.querySelector('.tv-userid');
        iLink.textContent = `@${t.userId}`; iLink.href = `https://x.com/${t.userId}`;
        const timeLink = viewer.querySelector('.tv-time');
        timeLink.textContent = t.postTimeStr; timeLink.href = t.url;
        const textLink = viewer.querySelector('.tv-text');
        textLink.textContent = t.text; textLink.href = t.url;
    };

    const navImage = (dir) => {
        if (!flatImageList.length) return;
        currentImageIndex += dir;
        if (currentImageIndex < 0) currentImageIndex = flatImageList.length - 1;
        if (currentImageIndex >= flatImageList.length) currentImageIndex = 0;
        updateImageViewer();
    };

    const updateCountLabel = () => { UI.count.innerText = `(${tweetLog.length}/${CONFIG.MAX_LOG_COUNT}件)`; };

    const renderFullLog = () => {
        // Apply View Mode
        const isTile = CONFIG.VIEW_MODE === 'tile';

        if (isTile) {
            UI.body.classList.add('tile-view');
            UI.body.style.setProperty('--tile-cols', CONFIG.TILE_SIZE);
            isShowMedia = true; // Force ON
            // Trigger Media Button State for Tile Mode (Forced)
            if (UI.btnToggleMedia) {
                UI.btnToggleMedia.disabled = true;
                UI.btnToggleMedia.classList.add('active');
            }
            if (UI.selTileSize) UI.selTileSize.disabled = false;
        } else {
            UI.body.classList.remove('tile-view');
            UI.body.style.removeProperty('--tile-cols');
            if (UI.btnToggleMedia) {
                UI.btnToggleMedia.disabled = false;
                // Reflect manual choice
                isShowMedia ? UI.btnToggleMedia.classList.add('active') : UI.btnToggleMedia.classList.remove('active');
            }
            if (UI.selTileSize) UI.selTileSize.disabled = true;
        }

        // Apply View Mode Classes to Body
        isShowMedia ? UI.body.classList.remove('hide-media') : UI.body.classList.add('hide-media');
        isShowRepost ? UI.body.classList.remove('hide-repost') : UI.body.classList.add('hide-repost');

        // Update Button Active States
        if (isTile) {
            UI.btnViewList.classList.remove('active');
            UI.btnViewTile.classList.add('active');
        } else {
            UI.btnViewList.classList.add('active');
            UI.btnViewTile.classList.remove('active');
        }

        isShowRepost ? UI.btnToggleRepost.classList.add('active') : UI.btnToggleRepost.classList.remove('active');

        if (CONFIG.IMAGE_ONLY_MODE) {
            if (UI.trigger) UI.trigger.classList.add('imgonlymode');
        } else {
            if (UI.trigger) UI.trigger.classList.remove('imgonlymode');
        }

        const sorted = [...tweetLog].sort((a, b) => {
            const vA = a[currentSortKey] || 0; const vB = b[currentSortKey] || 0;
            return currentSortOrder === 'desc' ? (vB - vA) : (vA - vB);
        });

        const fragment = document.createDocumentFragment();

        if (isTile) {
            sorted.forEach(t => {
                if (!isShowRepost && t.isRT) return;
                // Tile view requires media
                if (t.media && t.media.length) {
                    t.media.forEach((_, idx) => {
                        fragment.appendChild(createTileItem(t, idx));
                    });
                }
            });
        } else {
            sorted.forEach(t => fragment.appendChild(createLogItem(t)));
        }

        UI.body.innerHTML = '';
        UI.body.appendChild(fragment);
        updateCountLabel();
        UI.sortBtn.innerText = `並べ替え: ${currentSortKey === 'fetchTime' ? '取得時間' : '投稿時間'} ${currentSortOrder === 'desc' ? '▼' : '▲'}`;

        // Sync Select Value
        if (UI.selTileSize) UI.selTileSize.value = CONFIG.TILE_SIZE;
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

                const media = [];
                const photoContainers = article.querySelectorAll('[data-testid="tweetPhoto"]');
                photoContainers.forEach(container => {
                    const isVideo = container.querySelector('[data-testid="videoPlayer"]') !== null;
                    let img = container.querySelector('img');
                    let src = img ? img.src : null;
                    if (!src && isVideo) {
                        const video = container.querySelector('video');
                        if (video) src = video.poster;
                    }
                    if (src) media.push({ url: src, type: isVideo ? 'video' : 'photo' });
                });

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
                    isQuote, hasExternalLink
                };

                // Filter: Image Only Mode (Fetch filter)
                if (CONFIG.IMAGE_ONLY_MODE && (!data.media || data.media.length === 0)) return;

                if (saveTweet(data) && UI.modal.style.display === 'flex') {
                    // Optimized update logic handled by renderFullLog or selective prepend
                    renderFullLog();
                }
            } catch (e) { console.error('Capture error', e); }
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
            UI.inputs.fetchMode.value === CONFIG.FETCH_MODE &&
            UI.inputs.imgOnlyMode.checked === CONFIG.IMAGE_ONLY_MODE
        );
    };

    UI.btnSave.onclick = () => {
        CONFIG.MAX_LOG_COUNT = Math.min(2000, Math.max(10, parseInt(UI.inputs.maxCount.value)));
        CONFIG.DEBOUNCE_MS = Math.max(100, parseInt(UI.inputs.debounce.value));
        CONFIG.TRUNCATE_TEXT = Math.max(0, parseInt(UI.inputs.truncate.value));
        CONFIG.FETCH_MODE = UI.inputs.fetchMode.value;
        CONFIG.IMAGE_ONLY_MODE = UI.inputs.imgOnlyMode.checked;
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
            UI.inputs.imgOnlyMode.checked = CONFIG.IMAGE_ONLY_MODE;
            document.getElementById('desc-fetch-mode').innerText = CONFIG.FETCH_MODE === 'timeline' ? 'タイムラインのみ取得' : '全て取得';
            UI.settingsPanel.style.display = 'block';
            UI.btnSettings.classList.add('active');
            checkDirty();
        } else {
            UI.settingsPanel.style.display = 'none';
            UI.btnSettings.classList.remove('active');
        }
    };

    const closeModal = () => {
        UI.modal.style.display = 'none';
        UI.settingsPanel.style.display = 'none';
        UI.btnSettings.classList.remove('active');
    };

    UI.trigger.onclick = () => { renderFullLog(); UI.modal.style.display = 'flex'; };
    document.getElementById('btn-close').onclick = closeModal;
    UI.modal.onclick = (e) => { if (e.target === UI.modal) closeModal(); };
    UI.headerTitle.onclick = () => { UI.body.scrollTop = 0; };

    UI.btnViewList.onclick = () => {
        CONFIG.VIEW_MODE = 'list';
        localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG));
        renderFullLog();
    };
    UI.btnViewTile.onclick = () => {
        CONFIG.VIEW_MODE = 'tile';
        localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG));
        renderFullLog();
    };

    UI.selTileSize.onchange = (e) => {
        CONFIG.TILE_SIZE = parseInt(e.target.value);
        localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG));
        renderFullLog();
    };

    UI.btnToggleRepost.onclick = () => {
        isShowRepost = !isShowRepost;
        renderFullLog();
    };

    UI.btnToggleMedia.onclick = () => {
        isShowMedia = !isShowMedia;
        renderFullLog();
    };

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
        if (confirm('ログを全消去しますか？')) {
            tweetLog = [];
            processedTweetIds.clear();
            localStorage.removeItem(LOG_KEY);
            renderFullLog();
        }
    };

    [UI.inputs.maxCount, UI.inputs.debounce, UI.inputs.truncate, UI.inputs.imgOnlyMode].forEach(el => {
        el.oninput = checkDirty;
        el.onchange = checkDirty;
    });

    UI.inputs.fetchMode.onchange = () => {
        document.getElementById('desc-fetch-mode').innerText = UI.inputs.fetchMode.value === 'timeline' ? 'タイムラインのみ取得' : '全て取得';
        checkDirty();
    };

    // Image Viewer Events
    UI.imageViewer.onclick = (e) => { if (e.target === UI.imageViewer || e.target.classList.contains('tv-img-container')) UI.imageViewer.style.display = 'none'; };
    UI.imageViewer.querySelector('.tv-close').onclick = () => UI.imageViewer.style.display = 'none';
    UI.imageViewer.querySelector('.tv-nav-prev').onclick = (e) => { e.stopPropagation(); navImage(-1); };
    UI.imageViewer.querySelector('.tv-nav-next').onclick = (e) => { e.stopPropagation(); navImage(1); };

    renderFullLog(); // Initial render
    observer.observe(document.body, { childList: true, subtree: true });
})();