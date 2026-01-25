const state = {
    contextHistory: [],
    isDebating: false,
    debateRound: 0,
    globalFileContent: "",
    isFileEnabled: false,
    isMapOpen: false,
    currentViewMode: '2d', // '2d' or '3d'
    lastSentIndex: 0 // [新增] 记录已发送给主持人的消息索引
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
    state.lastSentIndex = 0; // [修改] 清空历史时重置索引
}

export function buildContextString() {
    if (state.contextHistory.length === 0) return "";
    return state.contextHistory.map(item => {
        const idInfo = item.key ? ` (ID: ${item.key})` : "";
        return `【${item.role}${idInfo}】:\n${item.content}`;
    }).join("\n\n");
}

/**
 * [新增] 获取增量上下文
 * @param {boolean} forceFull 是否强制获取全部历史（用于首轮）
 */
export function buildIncrementalContext(forceFull = false) {
    if (state.contextHistory.length === 0) return "";

    // 如果强制全量，从 0 开始；否则从上次的位置开始
    const startIndex = forceFull ? 0 : state.lastSentIndex;
    const newItems = state.contextHistory.slice(startIndex);
    
    // 更新索引，标记这些消息已被“消费”
    state.lastSentIndex = state.contextHistory.length;

    // 如果没有新内容且不强制全量，返回空字符串
    if (newItems.length === 0 && !forceFull) return "";

    return newItems.map(item => {
        const idInfo = item.key ? ` (ID: ${item.key})` : "";
        return `【${item.role}${idInfo}】:\n${item.content}`;
    }).join("\n\n");
}