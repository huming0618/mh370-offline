# MH370 离线数据（Android）

Capacitor + Vite + Leaflet。内置公开 CSV、分析图表，以及走廊 / 第七弧区域的离线底图瓦片。

- **包名**：`com.huming.mh370offline`
- **数据来源**：https://github.com/huming0618/mh370-data
- **瓦片策略**：预置 `public/offline-tiles` → Cache API → OSM → Carto（与火山/机场应用一致）
- **调试 APK**：仓库根目录 `app-debug.apk`（约 23 MB，含 z9–11 预置瓦片约 8100 块）

## 离线区域（mapbuddy）

`public/offline-regions.json` 定义四块 bbox：

1. SEA 马来半岛 / 马六甲（含 KLIA–IGARI）
2. SEA 安达曼 / VAMPI–MEKAR
3–4. 南印度洋第七弧西段 + 东段（约 33–36°S、85–105°E）

航路点坐标为 OpenNav / IFR 公开参考，**不是**军用一次雷达原档。第七弧紫色带为 ATSB 优先纬度示意矩形，**不是**精确 BTO 几何。

## 构建

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/workspace/android-sdk
npm install
# 推荐首包：z9–11（约 8100 块）。完整 z12 去重约 3.1 万块，APK 会更大。
MH370_ZMAX=11 node scripts/download-offline-tiles.js
VITE_BASE=./ npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/`；本仓库附带的 `app-debug.apk` 可直接安装。
