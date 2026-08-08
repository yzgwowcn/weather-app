// 地点服务层：地名搜索、逆地理编码、坐标工具与海南范围判断。
// 第一步：Photon（已有）搜索 + 手动坐标；第二步：高德 JS API 增强（AutoComplete/Geocoder/Geolocation）。
// 纯函数部分可在 Node 测试中直接加载（不依赖 DOM / AMap）。
const Location = (() => {
  'use strict';

  const HAINAN_BOX = { latMin: 18.1, latMax: 20.1, lonMin: 108.6, lonMax: 111.0 };

  function isInHainan(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon)
      && lat >= HAINAN_BOX.latMin && lat <= HAINAN_BOX.latMax
      && lon >= HAINAN_BOX.lonMin && lon <= HAINAN_BOX.lonMax;
  }

  function formatCoordName(lat, lon) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    return `自选点 (${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew})`;
  }

  function coordLabel(lat, lon) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
  }

  // ---- 搜索（防抖集中管理，300ms 默认） ----
  let searchTimer = null;
  function searchPlaces(keyword, debounceMs = 300) {
    const q = String(keyword || '').trim();
    return new Promise((resolve) => {
      clearTimeout(searchTimer);
      if (!q) { resolve([]); return; }
      searchTimer = setTimeout(async () => {
        try {
          const results = await API.searchLocation(q);
          resolve(results.map((item) => ({ ...item, inHainan: isInHainan(item.lat, item.lon) })));
        } catch {
          resolve([]);
        }
      }, debounceMs);
    });
  }

  // ---- 逆地理编码：Photon reverse（第二步接入高德 AMap.Geocoder 后优先走高德） ----
  async function photonReverse(lat, lon) {
    const url = `https://photon.komoot.io/reverse/?lat=${lat}&lon=${lon}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const p = data.features?.[0]?.properties || {};
    return {
      name: p.name || '',
      region: [p.city, p.state, p.country].filter(Boolean).join(' · '),
    };
  }
  async function reverseGeocode(lat, lon) {
    // 高德可用时优先高德（国内数据与地名合规）；否则回退 Photon
    if (typeof window !== 'undefined' && window.AMap && typeof AMap.Geocoder === 'function') {
      return new Promise((resolve) => {
        const geocoder = new AMap.Geocoder();
        geocoder.getAddress([lon, lat], (status, result) => {
          if (status === 'complete' && result?.regeocode?.formattedAddress) {
            const address = result.regeocode.formattedAddress;
            const city = result.regeocode.addressComponent?.city || '';
            const district = result.regeocode.addressComponent?.district || '';
            const region = [city, district].filter(Boolean).join(' · ');
            // 取地址中最后一段作为地点名（如"三亚市 亚龙湾路"→"亚龙湾路"）
            const parts = address.split(/[市县区镇村街道]/).filter(Boolean);
            const name = parts.length > 1 ? parts[parts.length - 1] : address;
            resolve({ name: name.trim() || address, region });
          } else {
            resolve({ name: '', region: '' });
          }
        });
      });
    }
    try {
      return await photonReverse(lat, lon);
    } catch {
      return { name: '', region: '' };
    }
  }

  // ---- GCJ-02 → WGS84 逆转换（高德坐标 → Open-Meteo 请求坐标） ----
  // 标准偏移模型：wgs84ToGcj02 正向 + 迭代逼近反向（3 次迭代精度 < 1 米），无外部依赖
  function outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function transformLat(x, y) {
    let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    ret += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
    ret += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
    return ret;
  }
  function transformLng(x, y) {
    let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
    ret += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
    ret += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
    return ret;
  }
  function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    const a = 6378245.0;
    const ee = 0.00669342162296594323;
    let dLat = transformLat(lng - 105, lat - 35);
    let dLng = transformLng(lng - 105, lat - 35);
    const radLat = lat / 180 * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
    dLng = (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
    return [lng + dLng, lat + dLat];
  }
  function gcj02ToWgs84(lng, lat) {
    if (outOfChina(lng, lat)) return [lng, lat];
    let wgsLng = lng;
    let wgsLat = lat;
    for (let i = 0; i < 3; i += 1) {
      const [gLng, gLat] = wgs84ToGcj02(wgsLng, wgsLat);
      wgsLng -= gLng - lng;
      wgsLat -= gLat - lat;
    }
    return [wgsLng, wgsLat];
  }

  // ---- 高德 JS API 状态 ----
  function isAMapReady() {
    return typeof window !== 'undefined' && typeof window.AMap !== 'undefined';
  }

  // ---- 地图拖点选点（高德 JS API 2.0） ----
  let mapInstance = null;
  let mapMarker = null;
  let mapPick = null;
  let mapReverseTimer = null;
  let mapCallbacks = null;
  let mapSearchAuto = null;
  let satelliteLayer = null;
  let roadNetLayer = null;

  function initMap(containerEl, callbacks = {}) {
    if (!isAMapReady()) return { ok: false, reason: 'AMap 未加载' };
    if (mapInstance) return { ok: true, map: mapInstance }; // 已初始化过则复用
    mapCallbacks = callbacks;
    mapInstance = new AMap.Map(containerEl, {
      center: [109.5, 19.0],
      zoom: 8,
      viewMode: '2D',
    });
    // 点击地图放置选点 Marker（GCJ-02 展示坐标 → WGS84 请求坐标）
    mapInstance.on('click', (e) => setMapPick(e.lnglat.lng, e.lnglat.lat));
    return { ok: true, map: mapInstance };
  }

  // 地图图层切换：satellite = 卫星底图 + 路网文字叠加；standard = 恢复默认底图
  function setMapLayer(type) {
    if (!mapInstance) return 'standard';
    if (type === 'satellite') {
      if (!satelliteLayer) satelliteLayer = new AMap.TileLayer.Satellite();
      if (!roadNetLayer) roadNetLayer = new AMap.TileLayer.RoadNet();
      satelliteLayer.setMap(mapInstance);
      roadNetLayer.setMap(mapInstance);
    } else {
      satelliteLayer?.setMap(null);
      roadNetLayer?.setMap(null);
    }
    return type === 'satellite' ? 'satellite' : 'standard';
  }

  function setMapPick(gcjLng, gcjLat) {
    if (!mapInstance) return;
    const [wgsLng, wgsLat] = gcj02ToWgs84(gcjLng, gcjLat);
    if (!mapMarker) {
      mapMarker = new AMap.Marker({ position: [gcjLng, gcjLat], draggable: true, cursor: 'pointer' });
      mapMarker.setMap(mapInstance);
      mapMarker.on('dragend', (e) => setMapPick(e.lnglat.lng, e.lnglat.lat));
    } else {
      mapMarker.setPosition([gcjLng, gcjLat]);
    }
    mapPick = { lng_gcj: gcjLng, lat_gcj: gcjLat, lng_wgs: wgsLng, lat_wgs: wgsLat, name: '', region: '' };
    // 逆地理编码：拖动停止后 400ms 防抖（避免频繁请求）
    clearTimeout(mapReverseTimer);
    mapReverseTimer = setTimeout(async () => {
      const info = await reverseGeocode(wgsLat, wgsLng);
      if (mapPick && Math.abs(mapPick.lat_wgs - wgsLat) < 1e-6 && Math.abs(mapPick.lng_wgs - wgsLng) < 1e-6) {
        mapPick.name = info.name || '';
        mapPick.region = info.region || '';
      }
      mapCallbacks?.onUI?.(mapPick);
    }, 400);
    mapCallbacks?.onUI?.(mapPick);
  }

  function getMapPick() { return mapPick; }

  function focusMapPick(gcjLng, gcjLat, zoom = 12) {
    if (!mapInstance) return;
    mapInstance.setCenter([gcjLng, gcjLat]);
    mapInstance.setZoom(zoom);
    setMapPick(gcjLng, gcjLat);
  }

  // 地图内搜索：AMap.AutoComplete 联想（内部完成认证，无额外签名）
  function bindMapSearch(inputEl) {
    if (!isAMapReady()) return null;
    if (mapSearchAuto) return mapSearchAuto;
    mapSearchAuto = new AMap.AutoComplete({ city: '海南', input: inputEl });
    mapSearchAuto.on('select', (e) => {
      const loc = e.poi?.location;
      if (loc) focusMapPick(loc.lng, loc.lat);
    });
    return mapSearchAuto;
  }

  // 当前定位：AMap.Geolocation（返回 GCJ-02 展示坐标 + WGS84 请求坐标）
  function getCurrentPosition() {
    return new Promise((resolve) => {
      if (!isAMapReady() || typeof AMap.Geolocation !== 'function') { resolve({ ok: false, reason: 'AMap.Geolocation 不可用' }); return; }
      const geolocation = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 8000 });
      geolocation.getCurrentPosition((status, result) => {
        if (status === 'complete' && result?.position) {
          const gcjLng = result.position.lng;
          const gcjLat = result.position.lat;
          const [wgsLng, wgsLat] = gcj02ToWgs84(gcjLng, gcjLat);
          resolve({ ok: true, lng_gcj: gcjLng, lat_gcj: gcjLat, lng_wgs: wgsLng, lat_wgs: wgsLat });
        } else {
          resolve({ ok: false, reason: '定位失败或已拒绝' });
        }
      });
    });
  }

  function destroyMap() {
    clearTimeout(mapReverseTimer);
    mapMarker = null;
    mapPick = null;
    mapCallbacks = null;
    if (mapInstance) { mapInstance.destroy(); mapInstance = null; }
  }

  return {
    searchPlaces,
    reverseGeocode,
    isInHainan,
    formatCoordName,
    coordLabel,
    gcj02ToWgs84,
    wgs84ToGcj02,
    isAMapReady,
    initMap,
    setMapLayer,
    setMapPick,
    getMapPick,
    focusMapPick,
    bindMapSearch,
    getCurrentPosition,
    destroyMap,
  };
})();
