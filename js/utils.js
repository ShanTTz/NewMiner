/**
 * 简单的 Markdown 转 HTML 解析器
 */
export function simpleMarkdownParser(text) {
    if (text === null || text === undefined) return '';
    let html = String(text);

    // 替换 <think> 标签
    html = html.replace(
        /<think>([\s\S]*?)<\/think>/gi, 
        '<details class="think-box"><summary class="think-title">点击查看深度思考过程...</summary>$1</details>'
    );

    const codeBlocks = [];
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
        codeBlocks.push(code.replace(/</g, '&lt;').replace(/>/g, '&gt;')); 
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    const lines = html.split('\n');
    let inTable = false;
    let tableHtml = '';
    let newLines = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line.startsWith('|') && line.endsWith('|')) {
            if (!inTable) { inTable = true; tableHtml = '<table>'; }
            if (!line.includes('---')) {
                const cells = line.split('|').filter(c => c.trim() !== '');
                tableHtml += '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
            }
        } else {
            if (inTable) {
                tableHtml += '</table>';
                newLines.push(tableHtml);
                inTable = false;
                tableHtml = '';
            }
            newLines.push(line);
        }
    }
    if (inTable) { newLines.push(tableHtml + '</table>'); }
    html = newLines.join('\n');

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^\- (.*$)/gim, '<ul><li>$1</li></ul>');
    html = html.replace(/<\/ul>\n<ul>/g, ''); 
    
    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
        return `<pre><code>${codeBlocks[index]}</code></pre>`;
    });
    
    html = html.replace(/\n/g, '<br>');
    return html;
}

/**
 * 清洗并提取 LLM 返回的 JSON 字符串
 */
export function cleanAndParseJson(responseStr) {
    let cleanStr = responseStr.replace(/```json/g, '').replace(/```/g, '').trim();
    // 移除截图可能出现的非法 ID 引用
    cleanStr = cleanStr.replace(/\[ID:\d+\]/g, '');

    const firstBrace = cleanStr.indexOf('{');
    const lastBrace = cleanStr.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
        cleanStr = cleanStr.substring(firstBrace, lastBrace + 1);
    }

    try {
        return JSON.parse(cleanStr);
    } catch (e) {
        console.warn("JSON Parse Error:", e);
        return null;
    }
}