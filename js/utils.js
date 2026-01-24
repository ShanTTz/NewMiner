/**
 * 增强版解析器：支持 JSON 清洗 + 正则回退 (关键修复)
 */
export function cleanAndParseJson(responseStr) {
    if (!responseStr) return null;

    // 1. 尝试清洗 JSON
    let cleanStr = responseStr.replace(/```json/g, '').replace(/```/g, '').trim();
    cleanStr = cleanStr.replace(/\[ID:\d+\]/g, ''); // 移除引用ID

    const firstBrace = cleanStr.indexOf('{');
    const lastBrace = cleanStr.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
        const jsonCandidate = cleanStr.substring(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(jsonCandidate);
        } catch (e) {
            console.warn("JSON Parse Failed, trying regex fallback...");
        }
    }

    // 2. [找回的功能] 正则回退机制 (Regex Fallback)
    // 如果 JSON 解析失败，尝试匹配 CMD 格式指令
    // 例如: "CMD: ASK geophysical 你能确认这个异常吗？"
    const askMatch = responseStr.match(/CMD:\s*ASK\s+(\w+)\s+(.+)/i);
    if (askMatch) {
        return { 
            action: 'ASK', 
            target: askMatch[1], 
            content: askMatch[2] 
        };
    }

    return null;
}

/**
 * Markdown 解析器 (保持不变)
 */
export function simpleMarkdownParser(text) {
    if (text === null || text === undefined) return '';
    let html = String(text);

    // 替换 <think>
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