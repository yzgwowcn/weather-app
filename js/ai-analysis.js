// 预设点 DeepSeek 分析客户端。自选点不调用；服务端失败时静默保留原规则文案。
const AIAnalysis = (() => {
  const PRESET_IDS = new Set([
    'sanya', 'lingshui', 'haitang', 'wanning', 'houhai',
    'chengdu', 'jiang-an', 'wangjiang', 'leshan', 'emeishan', 'jiuzhaigou', 'dujiangyan',
  ]);

  function isPreset(destination) {
    return !!destination && PRESET_IDS.has(destination.id);
  }

  async function fetchForPreset(destination, modelVersion, signal) {
    if (!isPreset(destination)) return { status: 'disabled', analyses: {} };
    if (!Number.isSafeInteger(Number(modelVersion)) || Number(modelVersion) <= 0) return { status: 'unavailable', analyses: {} };
    try {
      const response = await fetch('/api/weather-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId: destination.id, modelVersion: Number(modelVersion) }),
        signal,
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'ready' || !Array.isArray(data.analyses)) {
        return { status: data.status || 'unavailable', analyses: {}, retryAfterSeconds: data.retryAfterSeconds || 0 };
      }
      const analyses = Object.fromEntries(data.analyses
        .filter((item) => item && typeof item.date === 'string')
        .map((item) => [item.date, item]));
      return { status: 'ready', analyses, modelVersion: data.modelVersion, generatedAt: data.generatedAt, cached: data.cached === true };
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      return { status: 'unavailable', analyses: {} };
    }
  }

  return { fetchForPreset, isPreset };
})();
