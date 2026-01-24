import { AGENTS } from './config.js';
import { simpleMarkdownParser } from './utils.js';
import state, { addHistoryItem } from './state.js';

const chatStream = document.getElementById('chat-stream');

export function appendMessage(text, agentKey, type = 'agent', references = null) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    
    let avatarClass = 'c-general';
    let iconClass = 'fa-user';
    let name = '用户';
    let roleTextClass = '';

    if (type === 'agent' && AGENTS[agentKey]) {
        const agent = AGENTS[agentKey];
        avatarClass = agent.class;
        iconClass = agent.icon;
        name = agent.name;
        roleTextClass = agent.roleText;
    } else if (type === 'system') {
        avatarClass = 'c-system';
        iconClass = 'fa-cog';
        name = '系统通知';
    } else if (type === 'user') {
        roleTextClass = 't-general';
    }

    const htmlContent = simpleMarkdownParser(text);
    const refHtml = buildRefHtml(references);

    div.innerHTML = `
        <div class="avatar ${type === 'user' ? 'c-general' : avatarClass}" style="${type === 'user' ? 'background:#34495e':''}">
            <i class="fas ${iconClass}"></i>
        </div>
        <div class="content">
            <span class="sender-tag ${roleTextClass}">${name}</span>
            ${htmlContent}
            ${refHtml}
        </div>
    `;
    
    chatStream.appendChild(div);
    chatStream.scrollTop = chatStream.scrollHeight;
    
    if (type !== 'system') {
        const roleName = type === 'user' ? '用户' : (AGENTS[agentKey] ? AGENTS[agentKey].name : '未知');
        addHistoryItem(roleName, agentKey, text);
    }
}

function buildRefHtml(references) {
    if (!references || !Array.isArray(references) || references.length === 0) return '';
    
    const listItems = references.map(ref => {
        const docName = ref.document_name || ref.doc_name || "未知文档";
        const content = ref.content_with_weight || ref.content || "无内容";
        const sim = ref.similarity ? (ref.similarity * 100).toFixed(1) + '%' : '';
        return `
            <div class="ref-item">
                <div class="ref-header">
                    <span class="ref-doc-name"><i class="far fa-file-alt"></i> ${docName}</span>
                    <span class="ref-sim">${sim}</span>
                </div>
                <div class="ref-content-text">${content}</div>
            </div>`;
    }).join('');

    return `
        <div class="ref-wrapper">
            <details class="ref-box">
                <summary class="ref-summary"><i class="fas fa-quote-right"></i> 参考了 ${references.length} 处来源</summary>
                <div class="ref-list">${listItems}</div>
            </details>
        </div>`;
}

export function renderReportCard(data) {
    const isPrediction = data.hasOwnProperty("成矿概率");
    if (isPrediction) {
        let stampClass = "stamp-low";
        if ((data["成矿概率"]||"").includes("高")) stampClass = "stamp-high";
        else if ((data["成矿概率"]||"").includes("中")) stampClass = "stamp-med";

        return `
        <div class="report-card">
            <div class="stamp-badge ${stampClass}">成矿概率：${data["成矿概率"]}</div>
            <h3 style="color:#fff; margin-bottom:20px; border-bottom:1px solid #555; padding-bottom:12px; font-size: 20px;">
                <i class="fas fa-clipboard-check"></i> 综合评价报告
            </h3>
            <div class="report-section">
                <div class="report-title" style="color: #2ecc71"><i class="fas fa-crosshairs"></i> 有利部位</div>
                <div class="report-text highlight-loc">${data["有利部位"] || "未指定"}</div>
            </div>
            <div class="report-section">
                <div class="report-title" style="color: #3498db"><i class="fas fa-brain"></i> 成矿解释</div>
                <div class="report-text">${data["成矿解释"] || "无"}</div>
            </div>
            <div class="report-section">
                <div class="report-title" style="color: #f1c40f"><i class="fas fa-step-forward"></i> 下一步建议</div>
                <div class="report-text">${data["下一步建议"] || "无"}</div>
            </div>
        </div>`;
    } else {
        return `
        <div class="report-card general-mode">
            <div class="stamp-badge stamp-info">知识综述</div>
            <h3 style="color:#fff; margin-bottom:20px; border-bottom:1px solid #555; padding-bottom:12px; font-size: 20px;">
                <i class="fas fa-graduation-cap"></i> 地质知识研讨摘要
            </h3>
            <div class="report-section">
                <div class="report-title" style="color: #3498db"><i class="fas fa-lightbulb"></i> 核心结论</div>
                <div class="report-text">${data["研讨总结"] || data["summary"] || "无"}</div>
            </div>
        </div>`;
    }
}

export function showLoading(agentKey) {
    const div = document.createElement('div');
    div.id = `loading-${agentKey}`;
    div.className = `message agent`;
    const agent = AGENTS[agentKey] || { class: 'c-system', icon: 'fa-cog', name: 'System' };
    div.innerHTML = `
        <div class="avatar ${agent.class} thinking"><i class="fas ${agent.icon}"></i></div>
        <div class="content" style="color:#aaa; font-style:italic;">
            <i class="fas fa-circle-notch fa-spin"></i> ${agent.name} 正在思考...
        </div>`;
    chatStream.appendChild(div);
    chatStream.scrollTop = chatStream.scrollHeight;
}

export function removeLoading(agentKey) {
    const el = document.getElementById(`loading-${agentKey}`);
    if (el) el.remove();
}

export function clearChatUI() {
    chatStream.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'message agent';
    div.innerHTML = `<div class="avatar c-host"><i class="fas fa-eraser"></i></div><div class="content">屏幕已清空。</div>`;
    chatStream.appendChild(div);
}

// 文件处理
export function handleFileUpload(file) {
    if (!file) return;
    const nameDisplay = document.getElementById('file-name-display');
    nameDisplay.textContent = `加载中: ${file.name}`;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        state.globalFileContent = e.target.result;
        nameDisplay.textContent = `已就绪: ${file.name}`;
        document.getElementById('btn-toggle-file').disabled = false;
        if (!state.isFileEnabled) toggleFileContext(true);
        appendMessage(`📁 文件已加载: **${file.name}**\n已启用为全局研讨资料。`, null, 'system');
    };
    reader.onerror = () => appendMessage(`❌ 读取文件失败`, null, 'system');
    reader.readAsText(file);
}

export function toggleFileContext(forceState = null) {
    if (!state.globalFileContent) return;
    
    state.isFileEnabled = forceState !== null ? forceState : !state.isFileEnabled;
    const btn = document.getElementById('btn-toggle-file');
    const icon = btn.querySelector('i');
    const span = btn.querySelector('span');
    
    if (state.isFileEnabled) {
        btn.classList.add('active');
        icon.className = 'fas fa-toggle-on';
        span.textContent = "文件已启用";
    } else {
        btn.classList.remove('active');
        icon.className = 'fas fa-toggle-off';
        span.textContent = "文件未启用";
    }
}