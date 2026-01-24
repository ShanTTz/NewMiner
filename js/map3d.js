import state from './state.js';
import { invalidateMap, ensureMapOpen } from './map2d.js';

let my3DChart = null;
let is3DInitialized = false;

export function init3DModel() {
    const chartDom = document.getElementById('echarts-main');
    // 确保容器有尺寸
    if (chartDom.clientHeight === 0) {
        chartDom.style.height = '100%';
    }
    
    my3DChart = echarts.init(chartDom);
    const simplex = new SimplexNoise();

    // 1. 生成地形 (保持原版逻辑)
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

    // 2. [找回的功能] 生成矿体数据 [x, y, z, probability]
    function generateOreBody(centerX, centerY, centerZ, radius, count) {
        var data = [];
        for (var i = 0; i < count; i++) {
            var x = centerX + (Math.random() - 0.5) * radius;
            var y = centerY + (Math.random() - 0.5) * radius;
            var z = centerZ + (Math.random() - 0.5) * (radius * 0.7);
            
            // 计算距离中心的概率衰减
            var dist = Math.sqrt((x-centerX)**2 + (y-centerY)**2 + (z-centerZ)**2);
            var prob = Math.max(0, 1 - dist / (radius * 0.5));
            
            // 只保留概率较高的数据点
            if (prob > 0.15) {
                data.push([x, y, z, prob]);
            }
        }
        return data;
    }

    const terrainData = generateTerrain();
    
    // [找回的功能] 模拟三个主要矿集区数据
    const oreLuohe = generateOreBody(-2000, -1000, -900, 1400, 2000); // 罗河
    const oreNihe = generateOreBody(1500, 2000, -800, 1100, 1800);    // 泥河
    const oreShaxi = generateOreBody(3000, -2000, -700, 1000, 1500);  // 沙溪
    const allOreData = [].concat(oreLuohe, oreNihe, oreShaxi);

    const option = {
        tooltip: {
            show: true,
            formatter: function (params) {
                if (params.seriesIndex === 1) {
                    return params.marker + ' 成矿概率: ' + params.value[3].toFixed(2);
                }
                return '';
            }
        },
        visualMap: {
            show: true,
            seriesIndex: [1], 
            dimension: 3,
            min: 0,
            max: 1,
            inRange: {
                color: ['#313695', '#4575b4', '#74add1', '#ffffbf', '#fdae61', '#f46d43', '#d73027']
            },
            text: ['高概率', '低概率'],
            textStyle: { color: '#333' },
            bottom: 30,
            left: 'center',
            orient: 'horizontal',
            calculable: true
        },
        grid3D: {
            boxWidth: 220,
            boxDepth: 220,
            boxHeight: 90,
            environment: 'auto',
            light: {
                main: { intensity: 1.2, shadow: true, alpha: 50, beta: -30 },
                ambient: { intensity: 0.5 }
            },
            viewControl: {
                autoRotate: false,
                projection: 'perspective',
                alpha: 45,
                beta: 20,
                distance: 320,
                minAlpha: 5,
                maxAlpha: 90,
                panMouseButton: 'right',
                rotateMouseButton: 'left'
            },
            axisLine: { lineStyle: { color: '#333', opacity: 0.8 } },
            axisPointer: { show: false }
        },
        xAxis3D: { name: 'E (m)', min: -6000, max: 6000 },
        yAxis3D: { name: 'N (m)', min: -6000, max: 6000 },
        zAxis3D: { name: 'Elevation (m)', min: -3000, max: 1000 },
        series: [
            {
                type: 'surface',
                name: '地形',
                data: terrainData,
                shading: 'lambert',
                itemStyle: { color: '#e6c88c', opacity: 0.5 },
                wireframe: { show: true, lineStyle: { width: 0.5, color: 'rgba(0,0,0,0.15)' } },
                silent: true
            },
            {
                type: 'scatter3D', // [找回的功能] 矿体散点图
                name: '预测矿体',
                data: allOreData,
                symbolSize: 4,
                itemStyle: { opacity: 1 },
                blendMode: 'source-over'
            },
            {
                type: 'scatter3D', // [找回的功能] 地名标签
                data: [
                    { name: '罗河铁矿', value: [-2000, -1000, 400] },
                    { name: '泥河铁矿', value: [1500, 2000, 400] },
                    { name: '沙溪铜矿', value: [3000, -2000, 400] },
                    { name: '庐江县', value: [0, 200, 200] }
                ],
                symbolSize: 0,
                label: {
                    show: true,
                    position: 'top',
                    formatter: '{b}',
                    textStyle: {
                        color: '#000',
                        fontSize: 13,
                        fontWeight: 'bold',
                        backgroundColor: 'rgba(255,255,255,0.7)',
                        padding: [4, 6],
                        borderRadius: 4
                    }
                }
            }
        ]
    };
    my3DChart.setOption(option);
    is3DInitialized = true;
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
        mapEl.style.display = 'block'; // 注意：父容器需要显示
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