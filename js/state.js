const state = {
    contextHistory: [],
    isDebating: false,
    debateRound: 0,
    globalFileContent: "",
    isFileEnabled: false,
    isMapOpen: false,
    currentViewMode: '2d' // '2d' or '3d'
};

export default state;

export function addHistoryItem(role, key, content) {
    state.contextHistory.push({
        role,
        key,
        content: (typeof content === 'string') ? content : JSON.stringify(content)
    });
}

export function clearHistory() {
    state.contextHistory = [];
}

export function buildContextString() {
    if (state.contextHistory.length === 0) return "";
    return state.contextHistory.map(item => {
        const idInfo = item.key ? ` (ID: ${item.key})` : "";
        return `【${item.role}${idInfo}】:\n${item.content}`;
    }).join("\n\n");
}