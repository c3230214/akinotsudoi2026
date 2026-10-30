# 本番サーバーへの導入手順（ZIP移設）

この手順は、`build-zip.sh` で作ったZIPを研究室のLinuxサーバーへ移して動かすためのものです。パス、ユーザー名、ドメインは例です。大学側の公開許可、DNS、443番の受信経路を確認するまで、来場者へURLを配布しないでください（DECISION-C25）。

## 1. 前提

Node.js 22.13以降が必要です（`node:sqlite` を使うため）。`node --version` で確認します。SQLiteはNode.js内蔵のものを使うので、`better-sqlite3` のようなネイティブモジュールのコンパイルは不要です。ZIPには本番用の `node_modules` を同梱しているので、サーバーからnpmへの外向き通信がなくても起動できます。依存パッケージはすべてJavaScriptのみで、作成した環境とOSやCPUが違っても動きます。

`node:sqlite` はNode.js 22では「実験的」機能の扱いで、起動時に警告が出ます。起動コマンドに `--disable-warning=ExperimentalWarning` を付けて抑止しています。Node.jsのメジャー更新でAPIが変わる可能性があるため、本番直前にNode.jsを更新しないでください。

ブラウザがカメラを使えるのは、HTTPSのページか `localhost` だけです。カメラ画面（`/camera/`）は本番のHTTPSのURLで開いてください。HTTPのまま会場LANで試す場合は、Chromeの `chrome://flags/#unsafely-treat-insecure-origin-as-secure` にそのURLを登録する方法がありますが、試験用にとどめてください。

## 2. ZIPの作成（開発環境）

```sh
./build-zip.sh --with-qr
```

テストが通った場合だけ `dist/marugoto-bingo-<日時>-<コミット>.zip` ができます。`--with-qr` を付けると、印刷用スタンプQRと `stamp-tokens.json` を同梱します。`stamp-tokens.json` は印刷済みQRの原本で、これを持つ人は全マスのスタンプを取得できます。共有範囲に注意してください。

## 3. サーバーへの配置

```sh
sudo useradd --system --home /var/lib/marugoto-bingo --shell /usr/sbin/nologin marugoto-bingo
sudo mkdir -p /opt/marugoto-bingo /var/lib/marugoto-bingo /etc/marugoto-bingo /srv/backup/marugoto-bingo
sudo unzip marugoto-bingo-XXXX.zip -d /opt/marugoto-bingo/
sudo ln -sfn /opt/marugoto-bingo/marugoto-bingo-XXXX /opt/marugoto-bingo/current
sudo chown -R marugoto-bingo:marugoto-bingo /var/lib/marugoto-bingo /srv/backup/marugoto-bingo
sudo chmod 750 /var/lib/marugoto-bingo /srv/backup/marugoto-bingo
```

`/srv/backup` は、できればDBと別のディスクにします（§11）。

## 4. 環境変数ファイル

```sh
sudo cp /opt/marugoto-bingo/current/deploy/env.example /etc/marugoto-bingo/marugoto-bingo.env
openssl rand -base64 48   # CARD_CLAIM_SECRET に貼る
sudo chown root:marugoto-bingo /etc/marugoto-bingo/marugoto-bingo.env
sudo chmod 640 /etc/marugoto-bingo/marugoto-bingo.env
```

`PUBLIC_ORIGIN` に確定した公開URLを、`CARD_CLAIM_SECRET` に生成した値を入れます。管理パネル（`/admin/`）を使う場合は `ADMIN_PANEL_USER` と `ADMIN_PANEL_PASSWORD` に、運営で決めたIDとパスワードを入れます。空のままならパネルは無効です。この値はGitやZIPに含めないでください。`PUBLIC_ORIGIN` が仮の値のままだと起動を拒否します。`CARD_CLAIM_SECRET` を途中で変えると、発行済みデジタルカードの受付用QRがすべて無効になります。イベント中は変更しないでください。

## 5. 初期化（サービス起動前に1回）

以下は `marugoto-bingo` ユーザーで実行します。DBは最初のスクリプト実行時に作られ、migrationが番号順に1回だけ適用されます。

```sh
cd /opt/marugoto-bingo/current/server
E=/etc/marugoto-bingo/marugoto-bingo.env
N="node --env-file=$E --disable-warning=ExperimentalWarning"

# 管理者を作る（パスコードは画面に表示されない入力で聞かれる）
sudo -u marugoto-bingo $N scripts/createStaff.js --login admin --name 管理者 --role admin

# 印刷済みの8個のスタンプQR（①〜④、⑥〜⑨。⑤はQRなしでタップ達成）を登録する（ZIPに同梱した原本を使う）
sudo -u marugoto-bingo $N scripts/generateStampQr.js --import ../stamp-qr/stamp-tokens.json --out /var/lib/marugoto-bingo/stamp-qr

# 台担当（iPad＝ガラガラ1、Pixel Tablet＝ガラガラ2）と、WindowsPCの発券・カメラ用アカウント
sudo -u marugoto-bingo $N scripts/createStaff.js --login op1 --name ガラガラ1担当 --role operator
sudo -u marugoto-bingo $N scripts/createStaff.js --login op2 --name ガラガラ2担当 --role operator
sudo -u marugoto-bingo $N scripts/createStaff.js --login pc --name WindowsPC --role printer
sudo -u marugoto-bingo $N scripts/createStaff.js --login prize --name 景品交換所 --role prize

# （使う場合のみ）別プログラムで検出する会場PC用トークン。ブラウザのカメラ画面には不要

sudo -u marugoto-bingo $N scripts/issueDeviceToken.js --machine garagara-1
sudo -u marugoto-bingo $N scripts/issueDeviceToken.js --machine garagara-2
```

台担当、景品担当、発券端末のアカウントは、管理者でログインしたあと「管理」タブの「スタッフ一覧」から作れます。`createStaff.js --role operator` などでも作れます。

## 6. systemd とCaddy

```sh
cd /opt/marugoto-bingo/current/deploy
sudo cp marugoto-bingo.service.example /etc/systemd/system/marugoto-bingo.service
sudo cp marugoto-bingo-backup.service.example /etc/systemd/system/marugoto-bingo-backup.service
sudo cp marugoto-bingo-backup.timer.example /etc/systemd/system/marugoto-bingo-backup.timer
sudo cp marugoto-bingo-purge-images.service.example /etc/systemd/system/marugoto-bingo-purge-images.service
sudo cp marugoto-bingo-purge-images.timer.example /etc/systemd/system/marugoto-bingo-purge-images.timer
sudo systemctl daemon-reload
sudo systemctl enable --now marugoto-bingo marugoto-bingo-backup.timer marugoto-bingo-purge-images.timer
curl -s http://127.0.0.1:3000/health
```

`which node` が `/usr/bin/node` でない場合は、unitの `ExecStart` を書き換えます。Caddyは `Caddyfile.example` のホスト名を確定したものに書き換えて使います。SSEのために `flush_interval -1` を残してください。アプリは `127.0.0.1:3000` だけで待ち受けるので、外部からはCaddy経由でしか届きません。

## 7. 更新（新しいZIPを入れる）

新しいディレクトリに展開して `current` のリンクを付け替え、`systemctl restart marugoto-bingo` します。DBとアップロード画像は `/var/lib/marugoto-bingo` にあるので消えません。戻すときはリンクを前のディレクトリへ戻します。ただし新しい版でmigrationが追加されていた場合、古い版へは戻せないことがあります。更新前に手動バックアップを取ってください。

```sh
sudo -u marugoto-bingo node --env-file=/etc/marugoto-bingo/marugoto-bingo.env --disable-warning=ExperimentalWarning scripts/backup.js
```

## 8. 復元

1. `sudo systemctl stop marugoto-bingo`
2. 現在のDBを別名で退避し、`-wal` と `-shm` も一緒に退避する。
3. バックアップファイルを `DB_PATH` へコピーし、所有者を `marugoto-bingo` にする。
4. 起動後、スタッフ画面で両台を緊急停止にし、現物（玉、景品、引換券、紙の台帳）と照合してから再開する。

5分間隔のバックアップでは、最後のバックアップ以降の受付、確保、引換が失われます。復元後は、失われた時間帯に受け付けたカードを再受付しないよう、紙の台帳と照合する必要があります（DECISION-C24）。

## 9. 公開前に確認すること

`docs/CHECKLIST_BEFORE_PRODUCTION.md` を参照してください。HTTPSで公開URLを開き、来場者画面のカメラ起動（HTTPSが必須）、スタッフのログイン、WindowsPCの `/pc/` でカメラ3台とMP-B20の自動印刷（Chromeを `--kiosk-printing` 付きで起動）、iPadの `/garagara1/` とPixel Tabletの `/garagara2/` での受付から発券までを実機で確かめます。

会場マップは、DBにマップがないときだけ起動時に `server/config/map-2026.json` を取り込みます。以前のZIPで案の配置を取り込み済みのサーバーでは、`scripts/importMap.js --file config/map-2026.json` で完成版に置き換えてください。
