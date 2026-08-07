# こたけから、きょう。

小竹向原から約1時間以内で行ける、東京23区の「今日のイベント」を毎朝まとめるローカルWebサイトです。予約不要・当日券・途中参加など、当日に参加しやすい催しを優先し、終了・満席・受付終了が確認できたものは掲載しません。

オンライン版: <https://nekosama40.github.io/kotake-today/>

## サイトを開く

```powershell
npm install
npm run dev
```

表示された `http://127.0.0.1:5173` をブラウザで開きます。常用URLは `http://127.0.0.1:4173` です。本番用ファイルは次のコマンドで `dist/` に作成されます。

```powershell
npm run build
npm run serve
```

## 毎朝の自動更新

04:30にLuna（推論 `max`）で5系統のイベント調査を同時に開始し、06:25に検証済みデータだけをローカル公開、06:35にGitHub Pagesへ送信します。今日用3系統と明日・明後日用2系統に分かれ、アニメ・キャラクター／食べ物の専用調査に加えて、今日と翌日以降の両方にSNS優先調査があります。GitHub Pagesのデプロイ時間を25分見込み、通常は07:00までにオンライン版の更新が完了する構成です。5系統合計で80〜118回を目安に異なる検索・サイト確認を行います。各調査には最大90分を確保し、いずれかの調査や検証に失敗した場合は、現在公開中のデータを壊さず保持します。

SNS優先調査では、`config/research-sources.json` のマーク済みアカウントを参照します。高収率のアカウントを毎日優先し、それ以外はA・Bグループを日替わりで確認します。X・Instagramのプロフィールだけで候補にせず、日付付きの公開投稿から主催者・会場・出演者・出店者を辿り、公式ページやチケットページで受付状況を確認します。SNSに加えてPeatix、connpass、Doorkeeper、TwiPla、Meetup、自治体、施設、商店街なども並行して検索します。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-scheduled-tasks.ps1
```

登録解除:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\unregister-scheduled-tasks.ps1
```

手動実行:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-events.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\publish-events.ps1
```

登録すると、サイト本体もWindowsログオン時に自動起動します。調査ログは `logs/`、公開前データは `work/` に保存されます。Windowsにログイン中で、PCが起動またはスリープ中である必要があります。スリープ中はタスクがPCを起こす設定ですが、電源オフ中は実行できません。

## 品質確認

```powershell
npm run check
```

テスト、イベントデータ検証、TypeScriptと本番ビルドをまとめて実行します。

## 掲載方針

- 東京23区内、対象日当日、小竹向原から概ね60分以内
- 予約不要・当日受付・当日券・途中参加を優先
- 公式、自治体、施設、イベントサービス、公開SNS、店舗、学校、地域団体、小規模コミュニティまで横断
- X・Instagramはマーク済みイベントまとめアカウント＋日付・地域・ジャンルの組み合わせ検索を使用
- 受付終了、満席、売り切れ、中止、延期、終了済みは除外
- 画像は公式告知ページの公開画像をローカルへ保存し、1000px以内のWebPへ軽量化。取得できない場合はサイト内のカテゴリー画像を表示
- eスポーツは独立タブにせず、ほかのジャンルと同じタグ・候補として扱う

外部サーバーへの公開・独自ドメイン設定は含んでいません。`dist/` は一般的な静的ホスティングへそのまま配置できます。
