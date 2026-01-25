import { initMap, toggleMap, invalidateMap } from './map2d.js'; 
import { switchViewMode, resize3D } from './map3d.js';         
import * as UI from './ui.js';
import * as API from './api.js';
import state from './state.js'; 

document.addEventListener('DOMContentLoaded', () => {
    // 1. 初始化地图
    initMap();

    // 2. 欢迎语
    const welcomeDiv = document.createElement('div');
    welcomeDiv.className = 'message agent';
    welcomeDiv.innerHTML = `
        <div class="avatar c-host"><i class="fas fa-user-tie"></i></div>
        <div class="content">
            <span class="sender-tag t-host">主持人</span>
            欢迎使用地质成矿预测系统。请点击 <strong>[新建会话]</strong>，然后输入目标区域或问题。
        </div>
    `;
    document.getElementById('chat-stream').appendChild(welcomeDiv);

    // 3. UI 事件绑定
    const inputEl = document.getElementById('user-input');
    
    // 自动研讨
    document.getElementById('btn-auto-main').addEventListener('click', () => {
        const val = inputEl.value.trim();
        API.triggerDebateFlow(val);
        inputEl.value = '';
    });
    document.getElementById('btn-debate').addEventListener('click', () => {
        const val = inputEl.value.trim();
        API.triggerDebateFlow(val);
    });

    // 基础控制
    document.getElementById('btn-new-session').addEventListener('click', () => API.refreshAllSessions());
    document.getElementById('btn-clear-ui').addEventListener('click', () => {
        if(confirm('仅清空屏幕？')) UI.clearChatUI();
    });

    // 手动点名
    document.querySelectorAll('.manual-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const agent = btn.dataset.agent;
            const val = inputEl.value.trim();
            API.manualTrigger(agent, val);
            if(val) inputEl.value = '';
        });
    });

    // 紧急干预
    document.getElementById('btn-host-intervene').addEventListener('click', () => {
        const val = inputEl.value.trim();
        if(!val) { alert("请输入干预指令"); return; }
        API.triggerHostIntervention(val);
        inputEl.value = '';
    });

    // 文件上传
    document.getElementById('btn-trigger-upload').addEventListener('click', () => {
        document.getElementById('file-upload-input').click();
    });
    document.getElementById('file-upload-input').addEventListener('change', (e) => {
        UI.handleFileUpload(e.target.files[0]);
    });
    document.getElementById('btn-toggle-file').addEventListener('click', () => {
        UI.toggleFileContext();
    });

    // 视图切换
    document.getElementById('map-toggle-btn').addEventListener('click', toggleMap);
    document.getElementById('btn-2d').addEventListener('click', () => switchViewMode('2d'));
    document.getElementById('btn-3d').addEventListener('click', () => switchViewMode('3d'));
    
    // 4. [找回的功能] 窗口自适应监听 (Window Resize)
    // 修复：确保拖动浏览器窗口时，地图和3D模型能正确重绘
    window.addEventListener('resize', () => {
        if (state.currentViewMode === '3d') {
            resize3D();
        } else {
            invalidateMap();
        }
    });
});