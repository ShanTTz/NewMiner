import state from './state.js';
import { invalidateMap, ensureMapOpen } from './map2d.js';

let my3DChart = null;
let is3DInitialized = false;
let cachedTerrainData = []; // [新增] 缓存地形数据

export function init3DModel() {
    const chartDom = document.getElementById('echarts-main');
    if (chartDom.clientHeight === 0) {
        chartDom.style.height = '100%';
    }
    
    my3DChart = echarts.init(chartDom);
    const simplex = new SimplexNoise();

    function generateTerrain() {
        const data = [];
        for (let x = -5000; x <= 5000; x += 200) {
            for (let y = -5000; y <= 5000; y += 200) {
                const noise = simplex.noise2D(x / 3500, y / 3500) * 350;
                const basin = (x * x + y * y) / 60000;
                data.push([x, y, noise + basin - 450]);
            }
        }
        return data;
    }

    // 初始化时生成并缓存地形
    if (cachedTerrainData.length === 0) {
        cachedTerrainData = generateTerrain();
    }

    // 默认的模拟矿体（仅用于初始化展示）
    const initialOreData = []; // 初始化可以是空的，或者保留原来的演示数据

    const option = {
        tooltip: {
            show: true,
            formatter: function (params) {
                // 增强 tooltip，适配不同类型的数据
                if (params.seriesName === '钻孔点位') {
                    return `<strong>${params.name}</strong><br>位置: ${params.value[0]}, ${params.value[1]}<br>说明: ${params.value[3]}`;
                }
                return params.marker + params.seriesName;
            }
        },
        visualMap: {
            show: true,
            dimension: 2, // 根据 Z 轴高度着色
            min: -1000,
            max: 1000,
            inRange: {
                color: ['#313695', '#4575b4', '#74add1', '#ffffbf', '#fdae61', '#f46d43', '#d73027']
            },
            calculable: true
        },
        grid3D: {
            boxWidth: 200,
            boxDepth: 200,
            viewControl: {
                projection: 'perspective',
                autoRotate: false,
                distance: 300
            }
        },
        xAxis3D: { name: 'X/Lng', min: -6000, max: 6000 },
        yAxis3D: { name: 'Y/Lat', min: -6000, max: 6000 },
        zAxis3D: { name: 'Z/Depth', min: -2000, max: 1000 },
        series: [
            {
                type: 'surface',
                name: '地形',
                data: cachedTerrainData,
                shading: 'lambert',
                itemStyle: { color: '#e6c88c', opacity: 0.4 }, // 地形设为半透明
                wireframe: { show: false },
                silent: true
            },
            {
                type: 'scatter3D',
                name: '数据点',
                data: initialOreData
            }
        ]
    };
    my3DChart.setOption(option);
    is3DInitialized = true;
}

// [新增] 核心函数：根据 Host 返回的数据更新 3D 场景
export function update3DLayer(hostData) {
    if (!my3DChart) init3DModel(); // 确保已初始化
    if (!hostData) return;

    // 1. 解析数据
    const drillSites = hostData.drill_sites || [];
    const anomalies = hostData.geo_anomalies || [];
    const chemAnomalies = hostData.chem_anomalies || [];

    const newSeries = [];
    let allX = [];
    let allY = [];

    // 辅助函数：解析深度字符串 "500m" -> 500
    const parseDepth = (str) => {
        if (!str) return 0;
        const num = parseFloat(str);
        return isNaN(num) ? 0 : -Math.abs(num); // 深度转为负 Z 轴坐标
    };

    // A. 处理钻孔数据
    if (drillSites.length > 0) {
        const drillPoints = drillSites.map(d => {
            const x = d.lng || d.x; // 优先使用经度
            const y = d.lat || d.y; // 优先使用纬度
            const z = parseDepth(d.depth); 
            if (x && y) { allX.push(x); allY.push(y); }
            return {
                name: d.id,
                value: [x, y, 200, d.reason] // Z=200 让它浮在地形上方作为标记
            };
        });

        newSeries.push({
            type: 'scatter3D',
            name: '钻孔点位',
            symbol: 'arrow',
            symbolSize: 20,
            itemStyle: { color: '#ff0000' },
            data: drillPoints,
            label: { show: true, formatter: '{b}', textStyle: { fontSize: 14, borderWidth: 1 } }
        });
    }

    // B. 处理异常数据
    const allAnomalies = [...anomalies, ...chemAnomalies];
    if (allAnomalies.length > 0) {
        const anoPoints = allAnomalies.map(a => {
            const x = a.lng || a.x;
            const y = a.lat || a.y;
            if (x && y) { allX.push(x); allY.push(y); }
            return {
                name: a.type || a.element || '异常',
                value: [x, y, 0, a.desc] // Z=0 贴地
            };
        });

        newSeries.push({
            type: 'scatter3D',
            name: '异常区域',
            symbol: 'circle',
            symbolSize: 10,
            itemStyle: { color: 'yellow', opacity: 0.8 },
            data: anoPoints
        });
    }

    // 2. 动态调整坐标轴 (如果数据坐标是经纬度，需要调整视图范围，否则点会挤在一起)
    let axisConfig = {};
    if (allX.length > 0 && allY.length > 0) {
        const minX = Math.min(...allX);
        const maxX = Math.max(...allX);
        const minY = Math.min(...allY);
        const maxY = Math.max(...allY);
        
        // 计算跨度，防止 min==max
        const spanX = Math.max(maxX - minX, 0.01);
        const spanY = Math.max(maxY - minY, 0.01);

        axisConfig = {
            xAxis3D: { min: minX - spanX, max: maxX + spanX, name: 'Lng/X' },
            yAxis3D: { min: minY - spanY, max: maxY + spanY, name: 'Lat/Y' }
        };
        
        // 注意：如果使用的是真实经纬度，原有的地形（-5000到5000米）将不可见或不匹配。
        // 这里我们选择让视口聚焦在数据上。
    }

    // 3. 应用更新
    my3DChart.setOption({
        ...axisConfig,
        series: [
            // 保留地形作为背景（如果坐标差异太大，地形可能不可见，这符合预期）
            {
                type: 'surface',
                data: cachedTerrainData,
                itemStyle: { opacity: 0.1 } // 降低地形不透明度以突出数据
            },
            ...newSeries
        ]
    });
}

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
        
        if (!is3DInitialized) {
            init3DModel();
        } else {
            resize3D();
        }
    }
}

export function resize3D() {
    if (my3DChart) my3DChart.resize();
}