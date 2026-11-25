# 温湿度手记

在 Windows 或 macOS 上打开[温湿度手记网页版](https://yummy-he.github.io/ThermoJournal/)，或下载 [ThermoJournal.html](ThermoJournal.html) 后双击离线使用。两个版本都将记录保存在你选定的本地文件夹中。

## 第一次使用

1. 使用桌面 Chrome 打开 HTML。点「打开 data 文件夹」，选择已有的 `data`。首次使用也可以选择专用的空目录，页面会在其中建立 `data`。允许浏览器读写该目录。每次重新打开网页都可以重新选择目录。
2. 已有档案会直接显示。新设备点「添加设备」→「选择蓝牙设备」。让设备靠近电脑并退出米家的温湿度计页面。在系统选择器中选择自己的 LYWSD03MMC，填写别名，再保存。
3. 选中一个设备，点「刷新蓝牙数据」。将网页保持打开直至完成。完整读取后，网页保存原始 CSV，更新设备历史和总表，并按设备记录序号、计时和时间去重。
4. 换电脑时复制 HTML 和整个 `data`。新浏览器首次连接，请在「归档目标」选择这台实物原有的档案，以便续写同一份历史。

浏览器提供的蓝牙标识随浏览器配置和网页来源而异。已知 MAC 地址可以手动填写；未知时由程序生成独立的 `web-…` 档案标识。别名可在「设备管理」中修改。

## 查看和备份

- Safari 等浏览器可点「查看 CSV」打开设备历史或合并总表并浏览趋势。此模式只在内存中读表。刷新蓝牙及直接写入目录需要支持 Web Bluetooth 和目录写入的浏览器。若浏览器限制本地文件的蓝牙功能，可在受信任的 HTTPS 静态站点提供同一个 HTML，数据仍写入自己选定的本地目录。
- `data/all_devices.csv` 为合并总表。`data/<设备标识>/` 中保存 `device.json`、`history.csv` 和 `raw_exports/`。旧版 Windows 档案可以直接读取。
- 完整原始导出已保存而汇总写入失败时，关闭占用 CSV 的程序，再点「设备管理 → 重新合并」。备份或搬迁前，等待当前写入完成。同一个目录请使用一个应用实例进行采集。
- 周视图默认按日，也可选择「按小时」查看连续七天的 168 个小时。两图共用时间轴，滚轮按当前显示单位平移，日期框两侧的箭头按自然周期跳转。

## 开发

`app/web/` 存放页面资源。`python app/build_web.py` 同时生成离线版 `ThermoJournal.html` 和内容相同的网页版 `docs/index.html`。在 `main` 提交修改后，运行以下命令更新仓库和线上页面。第二条命令将 `docs/` 的内容推送到 GitHub Pages 使用的发布分支。

```sh
git push origin main
git subtree push --prefix=docs origin gh-pages
```

个人 `data/`、独立 CSV、蓝牙原始记录、虚拟环境、EXE 和 ZIP 已在 Git 中忽略。


运行回归测试：

```sh
node --test tests/standalone.mjs tests/directory.mjs tests/week.mjs
```
