export const API_BASE = 'http://127.0.0.1/api/v1/chats';
export const API_TOKEN = 'ragflow-Zk1KipZvDHTu7pS6GXQy5As-4bbvujpQPcM66nSdVDs';

export const AGENTS = {
    general: { id: 'bb1df310dbe111f087b8ee91a51e2da3', name: '通用知识', class: 'c-general', icon: 'fa-brain', roleText: 't-general', sessionId: null },
    geophysical: { id: '63a0d520dbe211f087b8ee91a51e2da3', name: '物探专家', class: 'c-geo', icon: 'fa-magnet', roleText: 't-geo', sessionId: null },
    geochemical: { id: '09304acadbed11f087b8ee91a51e2da3', name: '化探专家', class: 'c-chem', icon: 'fa-flask', roleText: 't-chem', sessionId: null },
    achievement: { id: '0daab9aadbed11f087b8ee91a51e2da3', name: '成果分析', class: 'c-achieve', icon: 'fa-chart-line', roleText: 't-achieve', sessionId: null },
    host: { id: '14a5f60cdbed11f087b8ee91a51e2da3', name: '主持人', class: 'c-host', icon: 'fa-user-tie', roleText: 't-host', sessionId: null }
};

export const MAX_DEBATE_ROUNDS = 5;