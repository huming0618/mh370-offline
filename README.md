# MH370 离线数据（Android）

Capacitor + Vite + Leaflet。内置公开 CSV、分析图表，以及马六甲走廊 / 第七弧示意带的离线底图瓦片。

- **包名**：`com.huming.mh370offline`
- **数据来源**：https://github.com/huming0618/mh370-data
- **瓦片策略**：预置 `public/offline-tiles` → Cache API → OSM → Carto（与火山/机场应用一致）

## 构建

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/workspace/android-sdk
npm install
npm run seed-offline-tiles   # 约 675 张，z6–11 分区
VITE_BASE=./ npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
```

## 说明

- 航路点坐标为 IFR/公开参考，**不是**军用一次雷达原档。
- 第七弧紫色带为 ATSB 优先纬度示意矩形，**不是**精确 BTO 几何。
