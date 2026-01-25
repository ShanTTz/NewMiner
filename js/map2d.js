import state from './state.js';
import { switchViewMode, resize3D } from './map3d.js';

let map = null;
let layers = {
    target: new L.LayerGroup(),
    drill: new L.LayerGroup(),
    geo_anom: new L.LayerGroup(),
    chem_anom: new L.LayerGroup()
};

export function initMap() {
    const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { 
        attribution: '&copy; CARTO', 
        subdomains: 'abcd',
        maxZoom: 20
    });
    
    const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        attribution: 'Tiles &copy; Esri' 
    });

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
         attribution: '&copy; OSM'
    });

    map = L.map('map', {
        center: [39.90, 116.40],
        zoom: 11,
        layers: [darkLayer, layers.target, layers.drill, layers.geo_anom, layers.chem_anom]
    });

    const baseMaps = {
        "深色模式": darkLayer,
        "卫星影像": satLayer,
        "标准地图": osmLayer
    };

    const overlayMaps = {
        "🎯 预测靶区": layers.target,
        "💎 钻孔部署": layers.drill,
        "🧲 物探异常 (Mag/Grav)": layers.geo_anom,
        "⚗️ 化探异常 (Chem)": layers.chem_anom
    };

    L.control.layers(baseMaps, overlayMaps).addTo(map);
    addLegend();
}

function addLegend() {
    const legend = L.control({position: 'bottomright'});
    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = `
            <div class="legend-item"><span class="legend-color" style="background:rgba(231,76,60,0.4);border:2px solid #e74c3c"></span> 核心靶区</div>
            <div class="legend-item"><span class="legend-color" style="background:rgba(46,204,113,0.5)"></span> 构造有利区</div>
            <div class="legend-item"><span class="legend-color" style="background:radial-gradient(circle, #3498db 0%, transparent 80%)"></span> 物探高磁异常</div>
            <div class="legend-item"><span class="legend-color" style="background:radial-gradient(circle, #f1c40f 0%, transparent 80%)"></span> 化探浓度中心</div>
            <div class="legend-item"><i class="fas fa-crosshairs" style="color:#e74c3c"></i> 建议孔位</div>
        `;
        return div;
    };
    legend.addTo(map);
}

export function toggleMap() {
    state.isMapOpen = !state.isMapOpen;
    const wrapper = document.getElementById('map-wrapper');
    const btnIcon = document.querySelector('#map-toggle-btn i');

    if (state.isMapOpen) {
        wrapper.classList.add('expanded');
        btnIcon.className = 'fas fa-chevron-right';
    } else {
        wrapper.classList.remove('expanded');
        btnIcon.className = 'fas fa-map-marked-alt';
    }

    // 延迟重绘以匹配 CSS 动画
    setTimeout(() => {
        if (state.currentViewMode === '2d' && map) map.invalidateSize();
        else resize3D();
    }, 550);
}

export function ensureMapOpen() {
    if (!state.isMapOpen) toggleMap();
}

/**
 * 核心：绘制复杂的图层数据 (修复版：增加容错)
 */
export function drawRichLayer(geoData) {
    // 1. 基础检查
    if (!map) return;
    
    // 自动切换视图并确保地图打开
    ensureMapOpen();
    if (state.currentViewMode === '3d') switchViewMode('2d');

    // 清空旧图层
    Object.values(layers).forEach(l => l.clearLayers());

    // =========================================
    // 修复点 1: 增加 try-catch 包裹地图操作
    // =========================================
    try {
        // 2. 绘制靶区 (增加坐标有效性检查)
        if (geoData.target_area && Array.isArray(geoData.target_area) && geoData.target_area.length > 2) {
            
            // 检查第一个坐标点是否合法 (防止 [null, null] 或 格式错误)
            const firstPoint = geoData.target_area[0];
            if (Array.isArray(firstPoint) && firstPoint.length === 2 && firstPoint[0] !== null) {
                
                const polygon = L.polygon(geoData.target_area, { 
                    color: '#e74c3c', weight: 3, fillColor: '#e74c3c', fillOpacity: 0.2 
                }).addTo(layers.target);
                
                polygon.bindPopup(`
                    <div class="popup-title">🎯 一级成矿远景区</div>
                    <div>${geoData["有利部位"] || "综合预测区域"}</div>
                `);

                // 延迟聚焦，防止地图未完全加载时报错
                setTimeout(() => {
                    try {
                        map.fitBounds(polygon.getBounds());
                    } catch(e) { console.warn("Auto-zoom failed", e); }
                }, 600);
            }
        }

        // 3. 绘制钻孔
        if (geoData.drill_sites && Array.isArray(geoData.drill_sites)) {
            geoData.drill_sites.forEach((site, idx) => {
                // 必须检查 lat/lng 是否存在
                if (site.lat && site.lng) {
                    const drillIcon = L.divIcon({ 
                        className: 'custom-drill-icon', 
                        html: `<div class="drill-icon-pulse"></div><div class="drill-symbol">⊕</div>`, 
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });

                    L.marker([site.lat, site.lng], {icon: drillIcon}).addTo(layers.drill)
                     .bindPopup(`
                        <div class="popup-title">💎 建议孔位: ${site.id || 'ZK'+(idx+1)}</div>
                        <div class="popup-row"><span class="popup-label">目的:</span> <span>${site.reason}</span></div>
                        <div class="popup-row"><span class="popup-label">设计孔深:</span> <span class="popup-val">${site.depth || '未知'}</span></div>
                    `);
                }
            });
        }

        // 4. 绘制异常
        if (geoData.geo_anomalies && Array.isArray(geoData.geo_anomalies)) {
            geoData.geo_anomalies.forEach(anom => {
                if (anom.lat && anom.lng) {
                    drawHeatPoint(anom, '#3498db', layers.geo_anom, {
                        title: '🧲 物探异常',
                        desc: anom.desc || '深部隐伏岩体引起'
                    });
                }
            });
        }

        if (geoData.chem_anomalies && Array.isArray(geoData.chem_anomalies)) {
            geoData.chem_anomalies.forEach(anom => {
                if (anom.lat && anom.lng) {
                    drawHeatPoint(anom, '#f1c40f', layers.chem_anom, {
                        title: '⚗️ 化探异常',
                        desc: anom.desc || '原生晕'
                    });
                }
            });
        }

    } catch (error) {
        console.error("Map Drawing Error:", error);
        // 即使地图画失败了，也不要让程序崩溃，静默失败即可
    }
}

// [找回的功能] 绘制多层同心圆模拟热力效果
function drawHeatPoint(data, color, layer, defaultInfo) {
    const info = { ...defaultInfo, ...data };
    
    // 弹窗内容生成器
    const popupContent = `
        <div class="popup-title" style="border-color:${color}">${info.title}</div>
        <div class="popup-row"><span class="popup-label">类型:</span> <span class="popup-val">${info.type || info.element || '未知'}</span></div>
        <div class="popup-row"><span class="popup-label">强度:</span> <span class="popup-val high">${info.value || 'High'}</span></div>
        <div class="popup-row"><span class="popup-label">成因:</span> <span>${info.desc}</span></div>
    `;

    // 核心 - 高亮
    L.circle([data.lat, data.lng], { 
        radius: (data.radius || 500) * 0.3, 
        color: 'transparent', fillColor: color, fillOpacity: 0.8 
    }).addTo(layer).bindPopup(popupContent);

    // 中圈 - 过渡
    L.circle([data.lat, data.lng], { 
        radius: (data.radius || 500) * 0.6, 
        color: 'transparent', fillColor: color, fillOpacity: 0.4 
    }).addTo(layer).bindPopup(popupContent);

    // 外圈 - 晕圈
    L.circle([data.lat, data.lng], { 
        radius: (data.radius || 500), 
        color: color, weight: 1, dashArray: '5, 5', fillColor: color, fillOpacity: 0.1 
    }).addTo(layer).bindPopup(popupContent);
}

export function invalidateMap() {
    if(map) map.invalidateSize();
}