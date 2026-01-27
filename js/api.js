import { API_BASE, API_TOKEN, AGENTS, MAX_DEBATE_ROUNDS } from './config.js';
import state, { buildContextString, clearHistory } from './state.js';
import * as UI from './ui.js';
import { cleanAndParseJson } from './utils.js';
import { drawRichLayer } from './map2d.js';

// 辅助：延迟函数
const delay = ms => new Promise(res => setTimeout(res, ms));

function getAugmentedPrompt(originalPrompt) {
    if (state.isFileEnabled && state.globalFileContent) {
        return originalPrompt + "\n\n【全局外部参考资料(用户上传)】:\n" + state.globalFileContent + "\n\n(请结合以上资料和你的知识库进行回答)";
    }
    return originalPrompt;
}

// ==========================================
// 1. 创建会话
// ==========================================
export async function refreshAllSessions() {
    clearHistory();
    UI.clearChatUI();
    const btn = document.getElementById('btn-new-session');
    const originalBtnHtml = `<i class="fas fa-sync-alt" style="color: #3498db;"></i> 新建会话 (申请ID)`;
    
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> 申请ID中...`;
    
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
// 2. 调用单体 Agent (增加重试机制)
// ==========================================
export async function callAgent(agentKey, promptText, hidden = false) {
    if (!hidden) UI.showLoading(agentKey);
    const agent = AGENTS[agentKey];
    
    // [修改] 最大重试次数
    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const payload = { "question": promptText, "stream": false };
            if (agent.sessionId) payload.session_id = agent.sessionId;

            // 这里可以添加 AbortController 来处理客户端超时，如果需要的话
            const response = await fetch(`${API_BASE}/${agent.id}/completions`, {
                method: 'POST',
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_TOKEN}` },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status}`);
            }

            const data = await response.json();
            
            // 成功获取数据
            if (data.code === 0 && data.data) {
                if (!hidden) UI.removeLoading(agentKey); // 成功时移除 Loading
                
                if (data.data.session_id) agent.sessionId = data.data.session_id;
                let answer = data.data.answer || "无回复";
                let refs = data.data.reference;
                if (refs && refs.chunks) refs = refs.chunks;
                
                if (!hidden) UI.appendMessage(answer, agentKey, 'agent', refs);
                return answer;
            } else {
                throw new Error(data.message || "API returned error code");
            }

        } catch (e) {
            console.warn(`[Attempt ${attempt}/${MAX_RETRIES}] Call ${agentKey} failed:`, e);
            lastError = e;
            
            // 如果不是最后一次尝试，等待两秒后重试
            if (attempt < MAX_RETRIES) {
                if (!hidden) {
                    // 可以在界面上显示一个小提示，或者静默重试
                    // UI.appendMessage(`连接不稳定，正在进行第 ${attempt} 次重试...`, null, 'system');
                }
                await delay(2000 + attempt * 1000); // 递增等待：3s, 4s...
            }
        }
    }

    // 所有重试都失败了
    if (!hidden) UI.removeLoading(agentKey);
    if (!hidden) UI.appendMessage(`⚠️ <strong>${agent.name} 掉线了</strong><br>原因: ${lastError.message || "连接超时"}<br>请检查后台服务或点击“紧急干预”手动继续。`, agentKey, 'system');
    return null;
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
        
        // 并行调用
        await Promise.all(['general', 'geophysical', 'geochemical', 'achievement'].map(k => callAgent(k, initialPrompt)));
        
        // 进入主持人循环
        await hostEvaluationLoop();
    } catch (e) {
        UI.appendMessage("研讨流程异常: " + e.message, null, 'system');
    } finally {
        state.isDebating = false;
        document.getElementById('btn-auto-main').disabled = false;
    }
}

// ==========================================
// 4. 主持人循环 (Host Loop - 增强版)
// ==========================================
async function hostEvaluationLoop() {
    let formatErrorCount = 0; // [修改] 记录连续格式错误的次数

    while (state.debateRound < MAX_DEBATE_ROUNDS) {
        state.debateRound++;
        const history = buildContextString();
        
        let promptText = `
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
        `;

        // [修改] 如果上次格式错了，追加一条强力提示，而不是直接让流程断掉
        if (formatErrorCount > 0) {
            promptText += "\n\n【系统警告】检测到上一次输出不是有效的 JSON 格式。请务必只输出 JSON 代码块，不要包含任何额外的分析文本！";
        }

        let hostPrompt = getAugmentedPrompt(promptText);

        UI.showLoading('host');
        let hostResponse = await callAgent('host', hostPrompt, true); // true 表示隐藏默认输出，由下面手动处理
        UI.removeLoading('host');
        
        if (!hostResponse) {
            UI.appendMessage("⚠️ 主持人响应超时或为空，流程已暂停。", null, 'system');
            break; 
        }

        const command = cleanAndParseJson(hostResponse);

        if (command) {
            formatErrorCount = 0; // 成功解析，重置错误计数

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
                    // 如果指定了不存在的专家，也算作一种异常，打印出来并结束
                    UI.appendMessage(hostResponse, 'host'); 
                    break;
                }
            }
        } else {
            // [修改] 解析失败处理逻辑
            console.warn("Parsing Host JSON failed:", hostResponse);
            
            if (formatErrorCount < 2) {
                // 给它 2 次自动修复的机会
                formatErrorCount++;
                state.debateRound--; // 这轮不算有效轮次
                UI.appendMessage(`(系统监控) 主持人输出格式异常，正在要求其重试... (${formatErrorCount}/2)`, null, 'system');
                // 继续下一次循环，会带上【系统警告】Prompt
                continue; 
            } else {
                // 彻底放弃，直接把文本显示出来，让用户决定
                UI.appendMessage(hostResponse, 'host'); 
                UI.appendMessage("⚠️ 主持人输出无法识别为指令，自动研讨中止。您可以点击【紧急干预】手动引导。", null, 'system');
                break;
            }
        }
    }
}

export async function manualTrigger(agentKey, val) {
    let prompt = val ? `用户提问：${val}\n历史：${buildContextString()}` : `请基于历史发言。\n历史：${buildContextString()}`;
    if(val) UI.appendMessage(`(指定) ${val}`, null, 'user');
    await callAgent(agentKey, getAugmentedPrompt(prompt));
}

// ==========================================
// 5. 紧急干预 (Intervention)
// ==========================================
export async function triggerHostIntervention(val) {
    if (!val) return;
    UI.appendMessage(`(干预指令) ${val}`, null, 'user');
    
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