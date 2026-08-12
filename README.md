# こたけから、きょう。

小竹向原から約1時間以内で行ける、東京23区の「今日・明日・明後日のイベント」を毎朝まとめるWebサイトです。予約不要・当日券・途中参加など、当日に参加しやすい催しを優先します。満席・受付終了は掲載せず、今日終了したイベントだけは「終了」を選んだ場合に確認できます。

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

02:30に1本の自動更新タスクを開始し、Luna（推論 `max`）の5系統調査、検証、ローカル公開、GitHub Pagesへの送信を順番に完了させます。04:30とWindowsログオン時にも同じタスクを確認用に起動しますが、当日データが完成済みならLuna調査を繰り返しません。今日用3系統と明日・明後日用2系統に分かれ、アニメ・キャラクター／食べ物の専用調査に加えて、今日と翌日以降の両方にSNS優先調査があります。5系統の終了後、日付別件数・主要ジャンル・小竹向原に近い区の不足を自動判定し、明確な穴がある日だけ6本目のLuna補完調査を行います。GitHub Pagesのデプロイ時間を含め、07:00までにオンライン版へ反映する構成です。通常5系統で80〜118回を目安に異なる検索・サイト確認を行い、補完時のみ12〜20回を追加します。調査や検証に失敗した場合は、現在公開中のデータを壊さず保持します。

`work/monthly-research-YYYY-MM-DD-to-YYYY-MM-DD.json` にLunaの月間下書きがある場合は、対象日を含む最新ファイルから候補を5系統へジャンル分担して渡します。候補はそのまま公開せず、毎朝あらためて公式URL・開催日・時間・受付状況を確認できたものだけを採用します。前回公開データと重複する候補は除き、下書きがない日や読み込みに失敗した場合も通常の新規検索を継続します。比較用の `monthly-sol-...` ファイルは自動更新では使用しません。

SNS優先調査では、`config/research-sources.json` のマーク済みアカウントを参照します。高収率のアカウントを毎日優先し、それ以外はA・Bグループを日替わりで確認します。X・Instagramのプロフィールだけで候補にせず、日付付きの公開投稿から主催者・会場・出演者・出店者を辿り、公式ページやチケットページで受付状況を確認します。SNSに加えてPeatix、connpass、Doorkeeper、TwiPla、Meetup、TIGET、teket、ZAIKO、自治体、施設、商店街なども並行して検索します。採用に結びついた発見元は内部集計し、次回の監視順へ反映します。

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

- 東京23区内、今日・明日・明後日の3日分、小竹向原から概ね60分以内・乗り換え1回まで
- 予約不要・当日受付・当日券・途中参加を優先
- 公式、自治体、施設、イベントサービス、公開SNS、店舗、学校、地域団体、小規模コミュニティまで横断
- X・Instagramはマーク済みイベントまとめアカウント＋日付・地域・ジャンルの組み合わせ検索を使用
- 受付終了、満席、売り切れ、中止、延期、終了済みは除外
- 画像は公式告知ページの公開画像をローカルへ保存し、1000px以内のWebPへ軽量化。取得できない場合はサイト内のカテゴリー画像を表示
- eスポーツは独立タブにせず、ほかのジャンルと同じタグ・候補として扱う

オンライン版はGitHub Pagesで公開します。`dist/` は一般的な静的ホスティングにも配置できます。
