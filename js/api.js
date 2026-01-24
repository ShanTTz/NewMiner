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

// 1. 创建会话
export async function refreshAllSessions() {
    clearHistory();
    UI.clearChatUI();
    const btn = document.getElementById('btn-new-session');
    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 申请ID中...`;
    
    const promises = Object.keys(AGENTS).map(async key => {
        try {
            const res = await fetch(`${API_BASE}/${AGENTS[key].id}/sessions`, {
                method: 'POST',
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_TOKEN}` },
                body: JSON.stringify({ name: "Session " + Date.now() })
            });
            const data = await res.json();
            if(data.code === 0 && data.data) AGENTS[key].sessionId = data.data.id;
            return true;
        } catch(e) { console.error(e); return false; }
    });
    
    await Promise.all(promises);
    btn.innerHTML = `<i class="fas fa-sync-alt" style="color: #3498db;"></i> 新建会话 (申请ID)`;
    UI.appendMessage(`<strong>会话已重置</strong><br>所有专家ID已刷新。`, null, 'system');
}

// 2. 调用单体 Agent
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

// 3. 研讨流程 (Debate Loop)
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

// 4. 主持人循环 (Host Loop)
async function hostEvaluationLoop() {
    while (state.debateRound < MAX_DEBATE_ROUNDS) {
        state.debateRound++;
        const history = buildContextString();
        
        // 提示词要求 Strict JSON
        let hostPrompt = getAugmentedPrompt(`
            你是主持人。审视历史发言，若观点冲突追问特定专家；若结论清晰输出最终报告。
            【必须输出 JSON】格式：{"action": "ASK", "target": "expert_key", "content": "question"} 
            或 {"action": "FINISH", "content": JSON_OBJECT_DATA}
            (FINISH时，JSON_OBJECT_DATA 应包含 "成矿概率","有利部位","target_area"等地图数据字段)
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
                    UI.appendMessage(hostResponse, 'host'); // 无法识别目标，显示原文
                    break;
                }
            }
        } else {
            UI.appendMessage(hostResponse, 'host'); // 解析失败，显示原文
            break;
        }
    }
}

export async function manualTrigger(agentKey, val) {
    let prompt = val ? `用户提问：${val}\n历史：${buildContextString()}` : `请基于历史发言。\n历史：${buildContextString()}`;
    if(val) UI.appendMessage(`(指定) ${val}`, null, 'user');
    await callAgent(agentKey, getAugmentedPrompt(prompt));
}

export async function triggerHostIntervention(val) {
    if (!val) return;
    UI.appendMessage(`(干预指令) ${val}`, null, 'user');
    let prompt = getAugmentedPrompt(`【最高优先级指令】用户下达：${val}。请立即执行并输出 JSON 指令。历史：${buildContextString()}`);
    
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