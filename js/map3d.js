import state from './state.js';
import { invalidateMap, ensureMapOpen } from './map2d.js';

let my3DChart = null;
let is3DInitialized = false;

// ============================================================================
// 1. 内置微型噪声算法 (彻底摆脱外部库依赖，防止地形生成失败)
// ============================================================================
const Noise = (function() {
    // 简单的伪随机哈希
    function hash(x, y) {
        let h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return h - Math.floor(h);
    }
    // 2D 值噪声插值
    function noise(x, y) {
        const i = Math.floor(x);
        const j = Math.floor(y);
        const f = x - i;
        const g = y - j;
        // 四个角的随机值
        const a = hash(i, j);
        const b = hash(i + 1, j);
        const c = hash(i, j + 1);
        const d = hash(i + 1, j + 1);
        // 平滑插值
        const u = f * f * (3.0 - 2.0 * f);
        const v = g * g * (3.0 - 2.0 * g);
        return a + (b - a) * u + (c - a + (d - c - (b - a)) * u) * v;
    }
    // 分形布朗运动 (FBM) - 用于生成逼真的山脉细节
    return {
        fbm: function(x, y) {
            let total = 0;
            let amplitude = 1.0;
            let frequency = 1.0;
            // 叠加 3 层噪声
            for (let i = 0; i < 3; i++) {
                total += noise(x * frequency, y * frequency) * amplitude;
                amplitude *= 0.5;
                frequency *= 2.0;
            }
            return total;
        }
    };
})();

// ============================================================================
// 2. 地形生成逻辑 (带高度和概率)
// ============================================================================
function calculateZ(x, y, minX, maxX, minY, maxY) {
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    
    // 归一化坐标
    const nx = (x - minX) / spanX * 5.0; // 5.0 是地形频率
    const ny = (y - minY) / spanY * 5.0;

    // 地形高度比例：地图跨度的 15%
    const heightScale = Math.max(spanX, spanY) * 0.15;

    // 使用 FBM 生成自然起伏
    const h = Noise.fbm(nx, ny);
    
    // 将噪声值 (0~2左右) 映射到高度
    return h * heightScale;
}

function generateSmartTerrain(minX, maxX, minY, maxY, points) {
    const data = [];
    const steps = 70; // 网格密度 (70x70)
    
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    
    // 靶区影响范围
    const influenceRadius = Math.max(spanX, spanY) * 0.15;

    for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps; j++) {
            const x = minX + (i * spanX) / steps;
            const y = minY + (j * spanY) / steps;
            
            // A. 计算高度
            const z = calculateZ(x, y, minX, maxX, minY, maxY);

            // B. 计算成矿概率 (用于变色)
            let finalProb = 0;
            if (points && points.length > 0) {
                let minDist = Infinity;
                for (let p of points) {
                    const d = Math.sqrt((x - p.x)**2 + (y - p.y)**2);
                    if (d < minDist) minDist = d;
                }
                
                if (minDist < influenceRadius) {
                    const distWeight = 1 - (minDist / influenceRadius);
                    // 增加一点随机纹理，让颜色看起来像地质图
                    const texture = Noise.fbm(x/spanX*20, y/spanY*20); 
                    finalProb = distWeight * (0.6 + texture * 0.4);
                }
            }
            
            data.push([x, y, z, finalProb]);
        }
    }
    return data;
}

// ============================================================================
// 3. ECharts 初始化与配置
// ============================================================================
export function init3DModel() {
    const chartDom = document.getElementById('echarts-main');
    if (chartDom.clientHeight === 0) {
        chartDom.style.height = '100%';
    }
    
    my3DChart = echarts.init(chartDom);

    // 默认展示一个演示地形
    const defaultTerrain = generateSmartTerrain(-100, 100, -100, 100, []);

    const option = {
        backgroundColor: '#ffffff',
        
        tooltip: {
            show: true,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            textStyle: { color: '#333' },
            formatter: function (params) {
                if (params.seriesName === '地形') {
                    const prob = params.value[3];
                    const probText = prob > 0.05 
                        ? `<span style="color:red;font-weight:bold">${(prob * 100).toFixed(1)}%</span>` 
                        : '植被覆盖';
                    return `<strong>监测区域</strong><br>状态: ${probText}`;
                }
                return params.name;
            }
        },

        // 【关键】颜色映射：深绿(背景) -> 黄 -> 红(靶区)
        visualMap: {
            show: true,
            dimension: 3, 
            min: 0,
            max: 1,
            seriesIndex: [0],
            calculable: true,
            inRange: {
                color: [
                    '#2E4B28', // 深绿 (卫星背景)
                    '#4F7942', // 蕨绿
                    '#FFFF00', // 黄色 (弱异常)
                    '#FF4500', // 橙红 (强异常)
                    '#FF0000'  // 纯红 (靶区)
                ]
            },
            text: ['高置信度', '背景'],
            textStyle: { color: '#000' },
            bottom: 30,
            left: 10
        },

        grid3D: {
            boxWidth: 200,
            boxDepth: 200,
            boxHeight: 100, 
            
            // 【防黑核心配置】
            // 1. 使用 lambert 材质保留立体感
            // 2. 只有环境光 + 强主光，关闭阴影 (shadow: false)
            light: {
                main: {
                    intensity: 1.2,
                    shadow: false, // 关掉阴影，防止黑块
                    alpha: 45,
                    beta: 30
                },
                ambient: {
                    intensity: 0.8 // 环境光拉高，确保背光面也是亮的
                }
            },
            viewControl: {
                projection: 'perspective',
                autoRotate: false,
                distance: 280,
                // 恢复全功能交互
                rotateSensitivity: 1,
                panSensitivity: 1,
                zoomSensitivity: 1
            }
        },

        xAxis3D: { 
            name: 'Lng', 
            nameTextStyle: { color: '#000', fontWeight: 'bold' },
            axisLine: { lineStyle: { color: '#000' } },
            axisLabel: { textStyle: { color: '#000' } }
        },
        yAxis3D: { 
            name: 'Lat', 
            nameTextStyle: { color: '#000', fontWeight: 'bold' },
            axisLine: { lineStyle: { color: '#000' } },
            axisLabel: { textStyle: { color: '#000' } }
        },
        zAxis3D: { show: false },

        series: [
            {
                type: 'surface',
                name: '地形',
                data: defaultTerrain,
                shading: 'lambert', 
                itemStyle: { opacity: 1 },
                wireframe: { show: false }
            },
            {
                type: 'scatter3D',
                name: '钻孔点位',
                data: []
            },
            {
                type: 'scatter3D',
                name: '异常区域',
                data: []
            }
        ]
    };
    my3DChart.setOption(option);
    is3DInitialized = true;
}

// ============================================================================
// 4. 数据更新逻辑 (恢复所有功能)
// ============================================================================
export function update3DLayer(hostData) {
    if (!my3DChart) init3DModel();
    if (!hostData) return;

    const drillSites = hostData.drill_sites || [];
    const anomalies = hostData.geo_anomalies || [];
    const chemAnomalies = hostData.chem_anomalies || [];
    
    // 收集坐标
    const allPoints = [];
    const allX = [];
    const allY = [];

    [...drillSites, ...anomalies, ...chemAnomalies].forEach(item => {
        const x = item.lng || item.x;
        const y = item.lat || item.y;
        if (x !== undefined && y !== undefined) {
            allX.push(x);
            allY.push(y);
            allPoints.push({x, y});
        }
    });

    if (allX.length > 0) {
        const minX = Math.min(...allX);
        const maxX = Math.max(...allX);
        const minY = Math.min(...allY);
        const maxY = Math.max(...allY);
        
        // 适当留边
        const spanX = Math.max(maxX - minX, 0.005);
        const spanY = Math.max(maxY - minY, 0.005);
        const padding = Math.max(spanX, spanY) * 0.5;

        const tMinX = minX - padding;
        const tMaxX = maxX + padding;
        const tMinY = minY - padding;
        const tMaxY = maxY + padding;

        // A. 生成地形
        const terrainData = generateSmartTerrain(tMinX, tMaxX, tMinY, tMaxY, allPoints);

        // B. 生成钻孔数据 (带悬浮高度)
        const drillSeries = drillSites.map(d => {
             const x = d.lng || d.x;
             const y = d.lat || d.y;
             if (x === undefined || y === undefined) return null;
             
             const groundZ = calculateZ(x, y, tMinX, tMaxX, tMinY, tMaxY);
             // 抬高防止被埋
             const z = groundZ + Math.max(spanX, spanY) * 0.15 * 0.1 + 2;
             
             return { 
                 name: d.id, 
                 value: [x, y, z, d.reason], 
                 itemStyle: { color: '#000', borderColor: '#fff', borderWidth: 1 } 
             };
        }).filter(Boolean);

        // C. 生成异常数据
        const anoSeries = [...anomalies, ...chemAnomalies].map(a => {
             const x = a.lng || a.x;
             const y = a.lat || a.y;
             if (x === undefined || y === undefined) return null;

             const groundZ = calculateZ(x, y, tMinX, tMaxX, tMinY, tMaxY);
             const z = groundZ + Math.max(spanX, spanY) * 0.15 * 0.1 + 2;
             
             return { 
                 name: a.type || '异常', 
                 value: [x, y, z, a.desc], 
                 itemStyle: { color: '#FF0000', borderColor: '#fff', borderWidth: 1 } 
             };
        }).filter(Boolean);

        // D. 应用更新
        const hScale = Math.max(spanX, spanY) * 0.15;
        my3DChart.setOption({
            xAxis3D: { min: tMinX, max: tMaxX },
            yAxis3D: { min: tMinY, max: tMaxY },
            zAxis3D: { min: -hScale * 1.5, max: hScale * 2.5 },
            series: [
                { type: 'surface', data: terrainData },
                { 
                    type: 'scatter3D', 
                    name: '钻孔点位', 
                    symbol: 'pin', 
                    symbolSize: 25, 
                    data: drillSeries,
                    label: { show: true, formatter: '{b}', position: 'top', textStyle: { color: '#000', backgroundColor: 'rgba(255,255,255,0.7)' } }
                },
                { 
                    type: 'scatter3D', 
                    name: '异常区域', 
                    symbol: 'circle', 
                    symbolSize: 10, 
                    data: anoSeries 
                }
            ]
        });
    }
}

// 视图切换保持不变
export function switchViewMode(mode) {
    state.currentViewMode = mode;
    ensureMapOpen();
    const mapEl = document.getElementById('map');
    const echartsEl = document.getElementById('echarts-main');
    const ctrl3d = document.getElementById('ctrl-panel-3d');
    const btn2d = document.getElementById('btn-2d');
    const btn3d = document.getElementById('btn-3d');

    if (mode === '2d') {
        mapEl.style.display = 'block';
        echartsEl.style.display = 'none';
        ctrl3d.style.display = 'none';
        btn2d.classList.add('active');
        btn3d.classList.remove('active');
        invalidateMap();
    } else {
        mapEl.style.display = 'block';
        echartsEl.style.display = 'block';
        ctrl3d.style.display = 'block';
        btn2d.classList.remove('active');
        btn3d.classList.add('active');
        if (!is3DInitialized) init3DModel(); else resize3D();
    }
}

export function resize3D() {
    if (my3DChart) my3DChart.resize();
}