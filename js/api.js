import { API_BASE, API_TOKEN, AGENTS, MAX_DEBATE_ROUNDS } from './config.js';
import state, { buildContextString, clearHistory } from './state.js';
import * as UI from './ui.js';
import { cleanAndParseJson } from './utils.js';
import { drawRichLayer } from './map2d.js';

function getAugmentedPrompt(originalPrompt) {
    if (state.isFileEnabled && state.globalFileContent) {
        return originalPrompt + "\n\n【全局外部参考资料(用户上传)】:\n" + state.globalFileContent + "\n\n(请结合以上资料和你的知识库进行回答)";
    }
    return originalPrompt;
}

// ==========================================
// 1. 创建会话 (保留功能：显示成功数 + 时间命名)
// ==========================================
export async function refreshAllSessions() {
    clearHistory();
    UI.clearChatUI();
    const btn = document.getElementById('btn-new-session');
    const originalBtnHtml = `<i class="fas fa-sync-alt" style="color: #3498db;"></i> 新建会话 (申请ID)`;
    
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 申请ID中...`;
    
    // 使用当前本地时间作为会话名
    const sessionName = "Session " + new Date().toLocaleString();

    const promises = Object.keys(AGENTS).map(async key => {
        try {
            const res = await fetch(`${API_BASE}/${AGENTS[key].id}/sessions`, {
                method: 'POST',
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_TOKEN}` },
                body: JSON.stringify({ name: sessionName }) 
            });
            const data = await res.json();
            if(data.code === 0 && data.data) {
                AGENTS[key].sessionId = data.data.id;
                return true;
            }
            return false;
        } catch(e) { 
            console.error(e); 
            return false; 
        }
    });
    
    const results = await Promise.all(promises);
    const successCount = results.filter(result => result === true).length;
    const totalCount = Object.keys(AGENTS).length;
    
    btn.innerHTML = originalBtnHtml;
    btn.disabled = false;
    
    UI.appendMessage(
        `<strong>会话已重置</strong><br>` +
        `已成功为 <strong>${successCount} / ${totalCount}</strong> 位专家申请新ID。<br>` +
        `<span style="font-size:12px;color:#aaa">新会话名称: ${sessionName}</span>`, 
        null, 
        'system'
    );
}

// ==========================================
// 2. 调用单体 Agent
// ==========================================
export async function callAgent(agentKey, promptText, hidden = false) {
    if (!hidden) UI.showLoading(agentKey);
    const agent = AGENTS[agentKey];
    
    try {
        const payload = { "question": promptText, "stream": false };
        if (agent.sessionId) payload.session_id = agent.sessionId;

        const response = await fetch(`${API_BASE}/${agent.id}/completions`, {
            method: 'POST',
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_TOKEN}` },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!hidden) UI.removeLoading(agentKey);

        if (data.code === 0 && data.data) {
            if (data.data.session_id) agent.sessionId = data.data.session_id;
            let answer = data.data.answer || "无回复";
            let refs = data.data.reference;
            if (refs && refs.chunks) refs = refs.chunks;
            
            if (!hidden) UI.appendMessage(answer, agentKey, 'agent', refs);
            return answer;
        } else {
            if (!hidden) UI.appendMessage(`⚠️ 错误: ${data.message}`, agentKey, 'system');
            return null;
        }
    } catch (e) {
        if (!hidden) UI.removeLoading(agentKey);
        if (!hidden) UI.appendMessage(`❌ 请求失败: ${e.message}`, agentKey, 'system');
        return null;
    }
}

// ==========================================
// 3. 研讨流程 (Debate Loop)
// ==========================================
export async function triggerDebateFlow(userInputVal) {
    if (state.isDebating) return;
    if (!userInputVal && state.contextHistory.length === 0) { alert("请输入研讨主题"); return; }
    
    state.isDebating = true;
    state.debateRound = 0;
    document.getElementById('btn-auto-main').disabled = true;

    if (userInputVal) UI.appendMessage(userInputVal, null, 'user');

    try {
        UI.appendMessage("正在通知所有专家进行独立分析...", null, 'system');
        let initialPrompt = getAugmentedPrompt(`用户问题：${userInputVal || "请继续分析"}\n请仅根据你的专业知识库进行分析。`);
        
        await Promise.all(['general', 'geophysical', 'geochemical', 'achievement'].map(k => callAgent(k, initialPrompt)));
        await hostEvaluationLoop();
    } catch (e) {
        UI.appendMessage("研讨流程异常: " + e.message, null, 'system');
    } finally {
        state.isDebating = false;
        document.getElementById('btn-auto-main').disabled = false;
    }
}

// ==========================================
// 4. 主持人循环 (Host Loop)
// ==========================================
async function hostEvaluationLoop() {
    while (state.debateRound < MAX_DEBATE_ROUNDS) {
        state.debateRound++;
        const history = buildContextString();
        
        // 【核心】：这里保留了您要求的原始强力提示词
        let hostPrompt = getAugmentedPrompt(`
            你是研讨会的主持人。
            【任务】
            1. 审视历史发言。若观点冲突或证据不足，追问特定专家。
            2. 若结论清晰，输出最终报告。
            
            【判断规则】
            - 如果是【成矿预测/找矿】任务：必须在 FINISH 时输出符合 **格式A** 的 JSON，包含钻孔点位和异常数据。
            - 如果是【通用地质/科普】任务：输出 **格式B**。
            
            【重要】请严格输出合法的 JSON 格式，不要在 JSON 内部包含 [ID:0] 等引用标记！
            
            【输出格式】必须是 Strict JSON：
            {"action": "ASK", "target": "expert_key", "content": "question"} 
            OR 
            {"action": "FINISH", "content": JSON_OBJECT}

            其中 JSON_OBJECT **格式A (预测)** 必须包含以下字段：
            {
                "成矿概率": "高/中/低", 
                "有利部位": "文字描述", 
                "成矿解释": "...", 
                "下一步建议": "...",
                "target_area": [[lat, lng], [lat, lng], ...],  <-- 靶区多边形坐标 (至少3个点)
                "drill_sites": [
                    {"lat": 39.91, "lng": 116.41, "id": "ZK01", "depth": "500m", "reason": "验证高磁异常中心"},
                    {"lat": 39.92, "lng": 116.42, "id": "ZK02", "depth": "300m", "reason": "验证化探晕圈"}
                ],
                "geo_anomalies": [
                    {"lat": 39.91, "lng": 116.41, "radius": 800, "type": "高磁", "value": "500nT", "desc": "深部隐伏岩体"}
                ],
                "chem_anomalies": [
                    {"lat": 39.92, "lng": 116.43, "radius": 500, "element": "Cu-Au", "value": "200ppm", "desc": "热液蚀变带"}
                ]
            }
            
            **格式B (通用)**: {"研讨总结": "...", "关键知识点": "...", "数据支撑": "..."}

            历史记录：${history}
        `);

        UI.showLoading('host');
        let hostResponse = await callAgent('host', hostPrompt, true);
        UI.removeLoading('host');
        if (!hostResponse) break;

        const command = cleanAndParseJson(hostResponse);

        if (command) {
            if (command.action === 'FINISH') {
                let content = command.content;
                if (typeof content === 'object') {
                    if (content.target_area || content.drill_sites) {
                        UI.appendMessage(`🗺️ 正在绘制：靶区、钻孔点位...`, null, 'system');
                        drawRichLayer(content);
                    }
                    content = UI.renderReportCard(content);
                }
                UI.appendMessage(content, 'host');
                UI.appendMessage("✅ 研讨结束。", null, 'system');
                break;
            } else if (command.action === 'ASK') {
                const targetKey = Object.keys(AGENTS).find(k => k.toLowerCase() === command.target.toLowerCase());
                if (targetKey) {
                    UI.appendMessage(`(追问 ${AGENTS[targetKey].name}) ${command.content}`, 'host');
                    await callAgent(targetKey, getAugmentedPrompt(`主持人追问：${command.content}`));
                } else {
                    UI.appendMessage(hostResponse, 'host'); 
                    break;
                }
            }
        } else {
            UI.appendMessage(hostResponse, 'host'); 
            break;
        }
    }
}

export async function manualTrigger(agentKey, val) {
    let prompt = val ? `用户提问：${val}\n历史：${buildContextString()}` : `请基于历史发言。\n历史：${buildContextString()}`;
    if(val) UI.appendMessage(`(指定) ${val}`, null, 'user');
    await callAgent(agentKey, getAugmentedPrompt(prompt));
}

// ==========================================
// 5. 紧急干预 (Intervention) - 【关键优化】
// ==========================================
export async function triggerHostIntervention(val) {
    if (!val) return;
    UI.appendMessage(`(干预指令) ${val}`, null, 'user');
    
    // 【修改点】：这里同步使用了强力 JSON 定义，确保干预时也能正确画图
    let prompt = getAugmentedPrompt(`
        【最高优先级指令】用户下达：${val}。
        请立即执行并输出 JSON 指令。
        
        【重要】若涉及地图更新/重绘，必须严格遵守 **格式A**：
        输出格式：{"action": "FINISH", "content": JSON_OBJECT}
        
        其中 JSON_OBJECT 必须包含：
        {
            "成矿概率": "...",
            "有利部位": "...",
            "target_area": [[lat, lng], ...],
            "drill_sites": [{"lat":..., "lng":..., "id":"...", "depth":"...", "reason":"..."}],
            "geo_anomalies": [...],
            "chem_anomalies": [...]
        }

        历史记录：${buildContextString()}
    `);
    
    UI.showLoading('host');
    const res = await callAgent('host', prompt, true);
    UI.removeLoading('host');
    if(!res) return;

    const cmd = cleanAndParseJson(res);
    if(cmd && cmd.action === 'FINISH') {
        if(cmd.content.target_area) drawRichLayer(cmd.content);
        UI.appendMessage(UI.renderReportCard(cmd.content), 'host');
    } else {
        UI.appendMessage(res, 'host');
    }
}