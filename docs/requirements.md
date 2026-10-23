# まるごと体験ビンゴ ソフトウェア仕様書・Claude Code向け統合版

文書日付：2026-10-22。対象イベント：かがやきライフタウン大垣 秋のつどい。開催日：2026-11-01（日）。前日準備：2026-10-31。会場：大垣城ホール。学生スタッフ：岐阜協立大学ソフトピア共同研究室。

このファイルは、ユーザー提示の「まるごと体験ビンゴ ソフトウェア仕様書（研究室サーバー版）」全14節、添付の計画案、紙ビンゴカード画像、景品表画像を、実装時に参照できる単一Markdownに整理したものである。原文の要件と、本統合時に検出した問題・提案は区別する。原文をそのまま実装可能と認定する文書ではない。

## 0. Claude Codeへの指示と資料の優先順位

実装前に既存リポジトリを調査し、既存の業務規則・テスト・素材の所在を確認する。未提供のmodel.jsやapp.jsを読んだと仮定しない。未確定事項を独断で本番仕様にしない。本書の「原文要件」は提示内容を整理したものであり、「矛盾・不足」「提案」は承認済みの変更ではない。特に第15節の実装阻害事項を先に確認する。判断が必要な箇所は設定・インターフェースとして分離し、暫定実装には暫定であることを明示する。

業務規則の参照元は企画仕様書v1.0（2026-09-29）と製作検討図面H01〜H06だが、本文・図面一式は今回未提供であり、照合できていない。提示本文にあるv1.0への参照は参照情報として保持する。原文中の埋め込み3件は図の内容が提供されていないため、構成図・状態遷移図・日程を推測して補完しない。

モックアップURL：https://maru-bingo-demo.sasaki-kiichiro.chatgpt.site/

今回、このURLからページ内容を取得できなかった。外観、DOM、JavaScript、model.js、app.js、assetsの内容は未確認である。実装担当が閲覧できる場合に確認する。添付紙カード画像を、9マスの配置・文言・色・装飾の一次デザイン基準とする。モックアップに自己押印や旧3色抽選が残っていても、その動作は採用しない。

添付資料名：`かがやきライフタウン大垣_学生による地域課題解決提案事業_計画案.txt`、`2026_秋のつどいビンゴカードデザイン_修正版.png`、`Image (1) 1.jpg`。画像のファイル名と内容の対応は実装環境で確認する。本Markdownには画像バイナリを埋め込んでいない。画像ファイルが手元になくても判断できるよう、必要な視覚情報を第2節と第3節に記述した。

## 1. 目的、範囲、本番優先順位

2025年度の紙中心の「まるごと体験ビンゴ」では、景品チェック・引渡し・在庫管理、ブースやステージの案内にスタッフの手間がかかっていた。Web版ビンゴと会場マップを作り直し、物理ガラガラ2台の抽選記録を研究室のオンプレミスLinuxサーバーへ集約し、Webビンゴと同期する。途中参加者が必ず受付へ立ち寄らなければならない導線、スタンプ設置場所の分かりにくさ、感想記入の負担、参加者数・景品消費の集計も背景課題である。ただし感想記入を廃止する変更は本仕様では確定していない。

v1.0からの変更は、抽選・在庫の正本を会場制御PCから研究室サーバーへ移すこと、玉を金・赤・白の3色から赤・緑・水色・白の4色へ変えること、2台運用と景品共有、Windows会場PC1台への機器集約、来場者によるマスの付け外しの廃止、紙カードに合わせたデジタルカードの外観である。

11月1日本番の対象は、デジタルカード発行・スタンプ、紙とデジタルの抽選受付、2台分の手入力とC2自動読取、結果確定・引換券発行、補充・戻し指示、景品引換、操作履歴、デジタルアンケートである。C2自動読取も本番対象だが、開発は手入力を先に完成させる。C2の判定結果を手入力と同じ画面で確認・修正できる構造にする。底ゲートによる自動回収と紙アンケート読取は対象外で、回収は担当者が行う。

公開サーバーは、今回の「来場者スマホが携帯回線から接続する」構成の前提である。デジタルカード一般に公開サーバーが絶対必須という意味ではない。カード使用済み化と抽選開始を同じトランザクションにするため、正本を一か所に集約する。

## 2. カード、デザイン、抽選規則

### 2.1 紙カードを基準とする外観

白地に、オレンジ・赤茶・黄の紅葉、葉、花、どんぐり、本などの秋の装飾がある。上部は朱色系の太い文字で「秋のつどい」「まるごと体験ビンゴ」の2段見出し。「秋」に「あき」、「体験」に「たいけん」などのふりがながある。HTMLではruby/rtを用いる。続くオレンジ色の角丸帯に「11/1(日) 大垣城ホール」を黒字で表示し、帯の内側に白い点線の縁取りを置く。右上には斜めのキリトリ線と「抽選確認」「キリトリ線」の文字がある。

カード本体は3×3。①〜⑨の番号は各マス左上。薄い緑系の細い罫線で区切る。実行委員会企画の背景はサーモン、体験工房は水色、感想と中央は白。画像から正確な色値は確定していないため、CSS色値を承認済み値として固定しない。

①左上：実行委員会企画を体験しよう。種別は実行委員会企画、背景サーモン。紙画像は細い枠と花の装飾。

②上中：パネルをみて感想を書こう。種別はパネル感想、背景白。紙画像は机と紙、動物風キャラクターのイラスト。

③右上：体験工房で体験しよう。種別は体験工房、背景水色。紙画像はテープ・はさみ・のり・紙などの工作道具。

④左中：体験工房で体験しよう。種別は体験工房、背景水色。紙画像は花束。

⑤中央：ビンゴに参加しよう。種別は参加、背景白。紙画像は秋の葉と花のリース。

⑥右中：実行委員会企画を体験しよう。種別は実行委員会企画、背景サーモン。紙画像はリス。

⑦左下：実行委員会企画を体験しよう。種別は実行委員会企画、背景サーモン。紙画像は舞台のカーテン。

⑧下中：発表をみて感想を書こう。種別は発表感想、背景白。紙画像は上部に三角旗、下部に花の装飾。

⑨右下：体験工房で体験しよう。種別は体験工房、背景水色。紙画像は紙に記入する白いキャラクター。

マスの文言の漢字にも紙画像を参考にふりがなを付ける。達成マスには秋の葉の印を重ねるが、文言を隠さない。紙と同じ素材を使用する場合はデジタル配信の利用条件を確認し、満たせない場合は種別ごとの簡単な図形に置き換える。素材の再利用許可は今回未確認。

右上の抽選確認の角はデジタルでも描き、受付済みになると「抽選済み」と表示する。紙は原文では抽選後に担当者が角を切り取る。C1が角の欠落を検出したら警告し、理由入力なしに受付しない。角の処理時点と再受付防止の問題は第15節を参照。

成立ライン数、抽選回数、受付用QR、アンケート、会場マップへの導線はカードの下に配置する。来場者のマスタップによる達成・取消は実装しない。スタッフの紙カード読取結果修正は別機能として許可する。

### 2.2 マス達成とライン判定

⑤はカード受取時に達成扱いとする暫定案。同文言が3つある実行委員会企画・体験工房は、ブースQRが種別を表し、その種別の空きマスを番号の小さい順に埋める暫定案。両方とも第13節の未確定事項である。

マス配列は①〜⑨の順、長さ9のboolean配列。読取結果に限りnullを許し、確定時はnullを解消する。ラインは縦3・横3・斜め2の計8本。0始まりの定義は次のとおり。

```js
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];
```

成立ライン数0なら抽選不可、1〜2ならN=1、3〜7ならN=2、8ならN=3。カード1枚につき受付は1回だけで、受付後にラインが増えても再抽選不可。Nは受付時のサーバー側の確定マスから計算し、クライアントの自己申告値を信用しない。

### 2.3 用語と判定

台はmachineIdで識別するガラガラ1台（例garagara-1）。抽選セッションは1枚のカードの受付から引換券発行までの記録で、各台で同時に一つだけ進行する。有効玉はそのセッションで最初に出たN個。超過玉はN+1個目以降で、上位等級でも当選に含めず戻し待ちにする。要確認玉は色未判定または順序不確実な玉で、確認完了まで当選を確定しない。未割当玉は待機中に出た玉で、次の参加者へ付けない。引換券はセッションに一つの券番号（例BM-0003）を持ち、再印刷しても番号を変えない。

当選の基準はハンドル回転数ではなく出玉順。要確認玉の順番は保持し、後続玉で置換しない。N=2で白・未判定・赤なら、2個目を保留し、赤は超過のまま。N個到達後も回収確認まで出玉を記録する。有効玉の景品残数が0なら「景品不足で保留」とし、担当者判断を待つ。判断後の具体的処理は未定義。

## 3. 景品、玉、2台の在庫

景品表画像と提示本文は一致する。1等は赤/red、お菓子詰め合わせ20個。2等は緑/green、りんごジュース60本。3等は水色/lightblue、駄菓子（むぎチョコ）140個。4等は白/white、駄菓子（うまい棒）380本。合計600個。有効玉1個につき景品1個を確保するため、確定できる有効抽選は最大600回であり、600人という意味ではない。色ごとの玉の手持ち総数と各台の初期投入数は未確定。

有効玉は回収後に保管し、初期設定では再投入しない。その色の景品を全数配るには、その色の玉が景品数以上必要。白玉200個なら白景品380本のうち最大200本しか配れない。設定・在庫画面で色別の「景品数−玉の手持ち数」の不足を示す。不足表示を非負にするならmax(0,差分)とし、元の差分と区別する。解消には追加調達か、承認を伴う有効玉再投入ルール変更が必要。

景品と未投入予備玉は2台共有。機内玉数、進行中セッション、案内iPad、補充計画は台別。補充時に投入先を記録する。両台の機内玉の色別合計がその色の景品残数を超える場合は警告する。景品共有は本文では採用されている一方、第13節では承認待ちとして残っている。

玉の帳簿と景品の帳簿を分ける。色確定した出玉は有効・超過を問わず機内数を1減らす。色未判定玉は未解決数として保持し、色確定時に減らす。有効玉の色確定時に景品を確保し、印刷失敗でも確保を維持する。超過玉は戻し待ち。受付時、機内にある色で景品残数0の色があれば受付を止める。

最初の受付以降はイベント設定を固定する。例外変更は全台停止・棚卸し後に設定版を切り替える。ただし例外手順と試験13の整合は第15節を参照。

## 4. システム構成と通信断

研究室Linuxサーバー1台がアプリ、SQLite、画像、バックアップを保持する。Node.js単一プロセスをsystemdサービスとして常駐させ、Caddyがsoftopia.gku.ac.jp配下の未確定サブドメインでHTTPS終端する。Dockerは使用しない。ブラウザはHTTPSで接続する。

会場PCはWindowsノート1台、2台の間に設置。C1カードカメラ1台、C2玉カメラ2台、レシートプリンター1台を接続し、カード・玉の読取と印刷を担当する。スタッフ用iPadは2台、各台に1台。案内iPadも2台、各台に1台。来場者スマホは不特定数で携帯回線からカード・スタンプ・アンケートに接続する。

会場PCは正本を持たず、未送信の出玉・カード読取結果を保持する。会場PC停止時はC1・C2・自動印刷が止まるが、原文ではiPadの紙マスタップ、デジタルQR読取、手書き券により継続する。ただし心拍条件・引換条件との矛盾は第15節を参照。

USBカメラ3台の帯域競合に注意する。MJPEGと解像度抑制、可能なら別ポート・ハブへの分散を検討し、3台同時撮影をリハーサルで確認する。

即時反映はSSE、操作は原則HTTP POST。ブラウザEventSourceの再接続を使う。カメラ利用を含む公開画面はHTTPSを前提とする。管理APIにはPUTが定義されているため、「すべてPOST」という原文表現との不一致は第15節を参照。

会場PCは台別に5秒ごとに心拍を送り、15秒届かない台は通信断として新規受付拒否。進行中セッションはサーバーに保持して停止し、復旧後にiPadが状態を再取得する。会場PCは未送信出玉をディスクに残し、復旧後に順番通り再送。検出から60秒以上経過して到着した出玉は要確認とし、現物照合後に確定する。復旧見込みがなければ手書き受付台帳・引換券の紙運用へ切り替え、終了後に台帳を入力する。切替・復旧手順は運営と事前確定する。

原文構成図の未提供埋め込み：`[embed: node/ec475d9d-326b]`。

## 5. 認証、役割、権限

権限はサーバーで判定する。URLの?role=は権限付与に使用しない。不許可操作は403。

来場者はカード発行時のCookieで自分のカード閲覧、スタンプ、アンケートを利用する。CookieはHttpOnly、Secure。台担当者はログイン名・パスコードで認証し、ログイン後に台を選ぶ。担当台の受付、紙読取修正、出玉修正・手入力、停止・回収・発券要求、補充・戻し、緊急停止・解除を行う。台選択と台への操作権限の具体的な紐付けは未定義。

景品担当はログイン名・パスコードで引換とアンケートのお礼を記録する。管理者は両台の担当者操作、設定、ブース編集、スタッフ登録、iPad登録、集計を行う。案内iPadは管理者発行の1回限りペアリングコードでCookieを取得し、担当台の進行閲覧のみ。

会場PCの検出プログラムは台別Bearerトークンで、出玉・カード読取・画像・心拍を送信する。会場PCのChrome発券画面は専用発券アカウントで印刷待ちを受信し結果を通知する。発券アカウントのrole・発行方法は原文に不足する。

緊急停止の解除と抽選再開は別操作。解除には理由必須、履歴に残す。解除だけで自動進行しない。物理停止機構は本仕様に定義されておらず、ソフトウェアの状態変更を機械の物理停止と同一視しない。

## 6. データモデルと永続化

SQLiteの1ファイルをWALモードで使用する。来場者カード・スタンプ・アンケートは通常テーブル。玉・景品・セッション・出玉は一つの抽選状態JSONを遷移させ、スナップショットと操作ログを保存する。カード全員分を抽選状態へ入れたり、スタッフ・案内画面へ全来場者データを配信したりしない。

```text
events: event_id, name, held_on, settings_json, settings_version
  イベント設定。次回は複製して作る。
machines: machine_id, name, device_token_hash, last_heartbeat_at, boot_id, last_seq
  台別の心拍・最終連番。
cards: card_id, kind(paper/digital), token_hash, claim, created_at, used_session_id, used_at
  card_id一意。used_atがNULLの行だけ使用済み化できる。
stamps: card_id, booth_no, stamped_at, actor
  主キー(card_id, booth_no)。同じブースの二重押印防止。
booths: booth_no, name, organizer, description, stamp_token, x, y, w, h
  stamp_tokenはブースQRのランダム値。
surveys: card_id, child, parent, rating, answered_at, gift_at
  card_id主キー。氏名・連絡先なし。
staff: staff_id, login_name, role, passcode_hash, active
  login_name一意。パスコードはscryptでハッシュ化。
staff_sessions: session_id, staff_id, expires_at
  ログインCookieに対応。
kiosk_pairings: code_hash, machine_id, expires_at, used_at
  1回限りの案内iPad登録コード。
draw_snapshot: id(常に1), revision, state_json, saved_at
  最新抽選状態。
action_log: seq, at, actor, action_json, result, revision_after
  追記のみ。監査・復元用。
device_events: machine_id, boot_id, seq, received_at, detected_at, payload_json, outcome_json
  主キー(machine_id, boot_id, seq)。出玉再送の重複除去。
images: image_id, kind, path, mime, bytes, created_at, delete_after
  画像本体は別ファイル、状態にはimage_idのみ。
```

抽選状態JSONは等級と景品数、台別機内玉数と進行中セッション、共有予備玉、補充計画、全セッションの出玉・有効/超過区分・景品確保・印刷・引換状態、未割当玉、戻し記録を持つ。操作履歴はJSONに入れずaction_logへ移す。全セッションを保持するため状態サイズはイベント中に増える点は残る。

## 7. 状態遷移と業務コマンド

台の進行は「抽選中→停止確認→回収確認」。券の印刷状態・引換状態は別に持つ。緊急停止は任意状態から入り、解除後は元の状態に戻るだけ。本番ではfinalizeResultの1操作で停止確認・回収確認・発券要求をまとめて記録する。

Node.js単一プロセスで業務操作を直列処理し、1操作を1トランザクションとして抽選状態・ログ・関連テーブルを更新する。受付担当操作にはexpectedRevisionを付け、サーバーrevisionと違えば409。DBコミット後にSSE配信する構成を提案するが、配信失敗時にDBを巻き戻さず再取得で復旧する契約を明文化する必要がある。

原文状態遷移図の未提供埋め込み：`[embed: node/232a60b9-edda]`。

### 7.1 コマンドの契約

cardRead / receiveCardRead：C1の読取画像、マス判定、角の有無を対象台の確認待ちに置く。この時点では受付しない。

confirmCardRead：台が待機中かつ緊急停止でなく、担当者がマスを確認・修正済みであること。修正理由を必須にし、確定マスからNを計算する。カード使用済み化とセッション作成を同じトランザクションで行う。元判定・修正後・理由を保存する。

start：デジタルカードQRのclaim一致と未使用を検証し、サーバー上のスタンプからNを計算して受付する。N=0は拒否。

manualBall：抽選中、操作ID必須。色を出玉順に記録し、先着N個を有効、それ以降を超過にする。機内玉数を減らし、有効玉なら景品確保。N個で入力を止めない。

removeManualBall：確定前の直前の手入力1個だけ、理由必須。機内玉数と景品確保を元に戻す。自動玉との混在時の「直前」の定義は未確定。

correctBall：確定前、理由必須。色を修正し、機内玉数と景品確保を付け替える。案内画面にも反映。

finalizeResult：N個以上の出玉があり、要確認玉・景品不足保留がなく、担当者が受け皿を空にしたことを確認済み。停止・回収・発券要求を一括記録し、発券画面へ送る。物理回収自体は人が行う。

recordPrintResult：発券要求済み。排紙の成否を記録。失敗時は同じ券番号で再印刷。ブラウザの印刷実行通知と人の排紙確認は区別が必要。

redeemPrize：原文では券が1回以上印刷済み、未引換であること。1券1回だけ引換済みにする。手書き券の扱いは第15節。

returnBalls：作業ID必須、戻し待ち数以内。指定台の機内数を増やす。同じ作業IDでは二重加算しない。

refillPlanned：作業ID必須、予備玉が足りること。実際の投入数だけ機内数を増やし、計画の未実施分を残す。

emergencyStop / resume：停止中は担当台の受付と結果確定を止める。解除は理由必須。解除と再開は別操作だが、再開コマンド名は未定義。

ballDetected：C2からの出玉を手入力と同じ規則で記録。待機中なら未割当。停止・回収・確定の境界で遅れて届いた出玉の所属は第15節。

### 7.2 出玉・補充画面

赤・緑・水色・白の大きなボタンに色名を併記する。押すたび「1個目 白」のように順番と色を積む。C2結果も同じ一覧に表示し、自信のない玉は要確認として同じ色ボタンで確定する。直前取消を用意し、理由を残す。操作IDで再送の二重記録を防ぐ。

スタッフ用iPadは、時刻を過ぎた補充計画の未実施分と、その台へ戻す超過玉を「今入れるべき玉」として色・個数で表示する。時刻到達や予定登録だけでは機内数を増やさず、実投入数の記録時に増やす。

## 8. 会場PCとの機器連携API

### 8.1 識別、順序、再送

出玉は(machineId, bootId, seq)で一意。bootIdは検出プログラム起動ごとのUUID。seqは起動内で台ごとに1から開始。2台の送信待ち列と連番は独立。各台で1件ずつ、前の応答を受けて次を送る。

通信エラー・タイムアウト・5xxは同じ内容で1秒、2秒、4秒と延ばし、最大10秒間隔で再送し続ける。送信待ちはディスク永続化し、再起動後も失わない。色が不確実ならdetectedColor:null、順序が不確実ならorderUncertain:true。時計をNTP同期する。

### 8.2 出玉送信

```http
POST /api/device/v1/ball-events
Authorization: Bearer <台ごとのトークン>
Content-Type: application/json
```

```json
{
  "machineId": "garagara-1",
  "bootId": "0b6f4c5e-2f7a-4f3e-9b1d-8e2a1c9d7f40",
  "seq": 42,
  "detectedColor": "green",
  "confidence": 0.91,
  "orderUncertain": false,
  "detectedAt": "2026-11-01T10:15:30.123+09:00",
  "imageId": "img_7Q2..."
}
```

新規記録は200で`{"duplicate":false,"sessionId":"BM-0003","order":2,"kind":"valid","needsReview":false}`。重複は200で`{"duplicate":true,...前回と同じ業務結果}`。待機中は200で`{"duplicate":false,"unassigned":true}`。いずれも次の連番へ進む。

連番欠落は409で`{"code":"SEQ_GAP","expectedSeq":41}`、expectedSeqから再送する。401/403は不正トークン・別台IDで送信停止と警告。422は形式不正で送信停止と警告。上記以外の4xxや同一キー別内容の扱いは未定義。

### 8.3 画像、心拍、状態

`POST /api/device/v1/images`：本文image/jpeg、300KB以下。出玉より先に送信し、応答imageIdをイベントに入れる。画像送信失敗で出玉記録を止めるかは未定義。

`POST /api/device/v1/heartbeat`：`{machineId,bootId,lastSeq,cameraOk,sensorsOk,at}`を5秒ごとに送る。cameraOk・sensorsOkの詳細構造は未定義。

`GET /api/device/v1/state`：抽選中か、N、出玉数を返し、会場PC表示に使う。

### 8.4 カード読取

C1は2台共用。会場PC画面またはC1横の切替スイッチで対象台を選びmachineIdへ入れる。自信のないマスはnull。サーバーは確認待ち表示だけを行う。

```http
POST /api/device/v1/card-reads
Authorization: Bearer <台ごとのトークン>
Content-Type: application/json
```

```json
{
  "machineId": "garagara-2",
  "bootId": "0b6f4c5e-2f7a-4f3e-9b1d-8e2a1c9d7f40",
  "readSeq": 7,
  "kind": "paper",
  "cells": [true, false, true, true, true, null, false, true, true],
  "cornerPresent": true,
  "qrPayload": null,
  "readAt": "2026-11-01T10:14:02.500+09:00",
  "imageId": "img_K8p..."
}
```

デジタルはcellsを送らず、qrPayloadにQR文字列を入れる。kindの値はcardsのpaper/digitalと揃える案だが、スキーマで明文化する。readSeqは出玉seqと別の台別連番で、重複扱いは出玉と同じ。保存テーブル・最終連番の不足は第15節。

実機前は`scripts/simulateDevice.js`で同じAPIへ送信し、スタッフ・案内iPadを試験する。

## 9. 画面とHTTP API

### 9.1 画面入口

`/visitor/`：カード、スタンプQR読取（カメラまたは画像）、会場マップ（ブース位置・紹介・ステージ予定）、アンケート（年齢区分・感想・同意）。カードには紙と同じ9マス、ライン数、抽選回数、受付QR、抽選確認の角を表示。

`/staff/`：ログイン・台選択、受付、出玉、停止・回収・発券、補充・戻し、機器、引換、在庫・履歴・設定。受付ではC1画像と判定を並べ、マスタップ修正、iPadカメラのデジタルQR読取を可能にする。機器画面は心拍・最終連番・連番欠落・カメラ状態・緊急停止/解除。管理者は両台在庫、CSV、イベント設定、ブース・スタッフ編集を行う。

`/staff/print-station`：会場PCのChromeで2台分の印刷待ちを受け、`--kiosk-printing`で印刷確認ダイアログを省く。原文CSSは80mm前提だが、プリンター紙幅は未確定。

`/kiosk/`：台別の「今すること」「あと何個」、等級、音声、キャラクター。音声なしでも文字と大きな個数で理解できる。

来場者・スタッフ・案内は別HTMLから読み込む。デモapp.jsのv3/v4描画関数の重複は、原本確認後に一方へ統合する。

### 9.2 API一覧

```text
POST /api/visitor/cards                 誰でも、回数制限。カード発行・Cookie付与
GET  /api/visitor/card                  来場者。自分のカード状態
GET  /api/visitor/card/qr.svg            来場者。cardIdとclaimを含む受付QR
POST /api/visitor/stamps                来場者。ブースQRで押印
POST /api/visitor/survey                来場者。アンケート
GET  /api/booths                        公開。ブース一覧
POST /api/staff/login                   スタッフ認証
POST /api/staff/logout                  スタッフログアウト
GET  /api/staff/view                    スタッフ向け抽選状態
POST /api/staff/commands                typeごとに役割検査
POST /api/staff/cards/accept            受付担当。デジタルQR受付
GET  /api/staff/images/:id              スタッフ。確認画像
GET  /api/staff/audit                   スタッフ。履歴、ページ送り、CSV
PUT  /api/admin/settings                管理者。設定
PUT  /api/admin/booths/:id               管理者。ブース更新
POST /api/admin/kiosk-codes             管理者。登録コード発行
GET  /api/admin/surveys/summary         管理者。アンケート集計
POST /api/kiosk/pair                    案内iPad。登録コードで台に紐付け
GET  /api/stream/staff                  スタッフSSE
GET  /api/stream/kiosk                  案内iPad SSE
POST /api/device/v1/ball-events         台別Bearer。出玉
POST /api/device/v1/card-reads          台別Bearer。カード読取
POST /api/device/v1/images              台別Bearer。画像
POST /api/device/v1/heartbeat           台別Bearer。心拍
GET  /api/device/v1/state               台別Bearer。台の状態
GET  /api/stream/print                  発券アカウント。印刷待ち
POST /api/print/results                 発券アカウント。印刷実行通知
```

staff/commandsの本文は`{type,machineId,expectedRevision,...}`。再送可能な操作にはoperationId等が必要だが、全操作共通の契約は原文にない。

SSEは接続時に全量、その後変化時に配信し、15秒ごとに生存通知。スタッフ・案内・印刷の各購読に権限を適用する。再接続時に最新全量を取得する。来場者カードの更新通知・ポーリング方式は未定義。

原文では状態変更要求のOriginが本番URLと一致するときだけ受理し、CookieのSameSite=Strictと併用する。ただしネイティブ機器送信はOriginを持たない場合があるため、機器APIへの適用範囲は第15節で解決する。

## 10. ファイル・関数構成

domainはDOM・DB非依存、dbは永続化、servicesはトランザクション・配信、httpは認証・入出力。domainはnode:testで単独試験可能にする。ブラウザはビルド工程なしの`<script type="module">`。以下は原文の予定構成であり、既存ファイルの存在を保証しない。

```text
server/
  package.json                         fastify, @fastify/static, @fastify/cookie,
                                       better-sqlite3, qrcode
  src/main.js                          main(); buildApp(deps)
  src/config.js                        loadConfig(env)
    PORT, DB_PATH, IMAGE_DIR, PUBLIC_ORIGINを検証
  src/db/connection.js                 openDatabase(path); runMigrations(db)
    WAL, foreign_keys, busy_timeout。番号順の一度だけのmigration
  src/db/migrations/001_init.sql
  src/db/repos/cardRepo.js
    insertCard(db,card); findCardByToken(db,token); findCardById(db,cardId)
    insertStamp(db,cardId,boothNo,at,actor); listStamps(db,cardId)
    markCardUsed(db,cardId,sessionId,at)
      used_at IS NULL条件。更新0件なら例外
  src/db/repos/boothRepo.js
    listBooths(db); findBoothByStampToken(db,token); updateBooth(db,boothNo,fields)
  src/db/repos/surveyRepo.js
    insertSurvey(db,cardId,answers,at); markGiftGiven(db,cardId,at)
    summarizeSurveys(db)
  src/db/repos/drawRepo.js
    loadSnapshot(db); saveSnapshot(db,state); appendActionLog(db,entry)
    listActionLog(db,{before,limit})
  src/db/repos/machineRepo.js
    findMachineByToken(db,token); recordHeartbeat(db,machineId,bootId,at)
    updateLastSeq(db,machineId,bootId,seq)
  src/db/repos/deviceEventRepo.js
    findDeviceEvent(db,machineId,bootId,seq); insertDeviceEvent(db,event)
    lastSeqOf(db,machineId,bootId)
  src/db/repos/staffRepo.js
    findStaff(db,loginName); insertStaff(db,staff); insertSession(db,session)
    findSession(db,sessionId); deleteSession(db,sessionId)
  src/storage/imageStore.js
    saveImage(buffer,mime); resolveImagePath(imageId); purgeExpired(now)
    形式・サイズ検証、ランダム名、delete_after経過画像削除
  src/domain/errors.js                 DomainError(code,message)
  src/domain/rules.js
    COLORS=['red','green','lightblue','white']; LINES
    completeLines(marks); entitledDraws(lines); validateMarks(marks)
  src/domain/card/cardModel.js
    newCard(kind,now); parseStampPayload(text); parseCardPayload(text)
    toCardView(card,stamps)
    newCardは表示ID、Cookieトークン、QR claimを生成
    QR形式: MARUGOTO2026:STAMP:<stamp_token>
    QR形式: MARUGOTO2026:CARD:<cardId>:<claim>
  src/domain/card/cardLayout.js
    CELLS; nextCellFor(category,marks)
  src/domain/draw/state.js
    initialState(eventConfig); machineOf(s,machineId); currentSession(s,machineId)
    reservedCount(s,color); remainingPrizes(s,color); ballsInMachines(s,color)
    storedBalls(s,kind,color); isBusy(s,machineId); requireIdle(s,machineId)
    reservePrize(s,ball)
    initialStateはgrades,machines{id:{contents,activeSessionId,stopped}},stock,plans
  src/domain/draw/transition.js
    transition(state,action)
    複製→handlers[type]→revision+1→{state,message,events}
  src/domain/draw/handlers/intake.js
    start(s,a); receiveCardRead(s,a); confirmCardRead(s,a)
  src/domain/draw/handlers/balls.js
    ballDetected(s,a); manualBall(s,a); removeManualBall(s,a)
    correctBall(s,a); resolveUnassigned(s,a)
  src/domain/draw/handlers/finish.js
    stopDrawing(s,a); collectBalls(s,a); finalizeResult(s,a)
  src/domain/draw/handlers/vouchers.js
    requestPrint(s,a); recordPrintResult(s,a); redeemPrize(s,a)
    selectSession(s,a); nextVisitor(s,a)
  src/domain/draw/handlers/inventory.js  returnBalls(s,a); refillPlanned(s,a)
  src/domain/draw/handlers/settings.js   updateSettings(s,a)
  src/domain/draw/handlers/safety.js     emergencyStop(s,a); resume(s,a)
  src/domain/draw/projections.js
    toStaffView(s); toKioskView(s,machineId)
    shortageByColor(s,ballsInHand); refillGuide(s,machineId,now)
  src/services/drawService.js
    createDrawService({db,bus,now}); execute(action,actor,expectedRevision)
    getStaffView(); getKioskView(machineId)
  src/services/cardService.js
    issueCard(); getCard(token); stamp(token,payload)
    acceptDigitalCard(payload,machineId,actor,expectedRevision)
    acceptPaperCard(count,machineId,actor,expectedRevision)
  src/services/deviceService.js
    receiveBallEvent(machineId,body); receiveHeartbeat(machineId,body)
    receiveCardRead(machineId,body); isOnline(machineId,now); getDeviceStatus()
  src/services/surveyService.js
    submitSurvey(token,answers); giveGift(cardId,actor); getSummary()
  src/services/authService.js
    hashSecret(plain); verifySecret(plain,hash); login(loginName,passcode)
    logout(sessionId); authenticate(sessionId); pairKiosk(code)
  src/realtime/bus.js                   createBus(): publish/subscribe
  src/realtime/sse.js                   registerStream(app,bus,topic,projector)
  src/http/hooks/auth.js                requireRole(...roles); requireDevice(); requireKiosk()
  src/http/hooks/origin.js              verifyOrigin()
  src/http/hooks/rateLimit.js           limitByIp(key,perMinute)
  src/http/errorHandler.js              errorHandler(err,req,reply)
  src/http/schemas.js
  src/http/routes/visitor.js
  src/http/routes/staff.js
  src/http/routes/admin.js
  src/http/routes/kiosk.js
  src/http/routes/device.js
  src/http/routes/stream.js
  scripts/createStaff.js
  scripts/issueDeviceToken.js
  scripts/issueKioskCode.js
  scripts/generateBoothQr.js
  scripts/simulateDevice.js
  scripts/importSettings.js
  test/rules.test.js
  test/draw.twoMachines.test.js
  test/draw.excessAndReview.test.js
  test/device.idempotency.test.js
  test/card.accept.test.js
web/
  shared/html.js                       esc,btn,pill,ball,field,select,head,panel
  shared/api.js                        getJson(url); postJson(url,body)
  shared/stream.js                     openStream(url,onView,onStatus)
  shared/ui.js                         toast(text); showModal(html); closeModal()
  shared/scanner.js                    start; stop; fromFile（現scanner.jsを流用予定）
  shared/vendor/jsQR.js
  visitor/index.html
  visitor/main.js                      boot(); route()
  visitor/views/card.js
    renderCard(view); renderCell(cell,marked); renderLotteryCorner(used); bindCard()
  visitor/views/scan.js                 openScanner(); handleScanned(text)
  visitor/views/map.js                  renderMap(booths); mountMap()
  visitor/views/survey.js               renderSurvey(view); bindSurvey()
  staff/index.html
  staff/main.js                        boot(); route(); applyView(view)
  staff/views/login.js                 renderLogin(); bindLogin()
  staff/views/intake.js
    renderIntake(view,machineId); renderCardReview(read); bindCellToggle()
  staff/views/balls.js
    renderBallReview(session); bindCorrection(); bindManualBall()
  staff/views/finish.js                 renderFinish(session)
  staff/views/vouchers.js
    renderVouchers(view); renderReceipt(session); bindRedeem()
  staff/views/stock.js
    renderStock(view); renderReturn(kind); renderRefillGuide(guide)
  staff/views/devices.js                renderDevices(status)
  staff/views/audit.js                  renderAudit(page)
  staff/views/settings.js              renderSettings(view); renderBooths(booths); renderStaff(list)
  staff/print/receipt.js                printReceipt(session), 80mm CSS, window.print()
  staff/views/printStation.js           renderPrintStation(queue); printNext()
  kiosk/index.html
  kiosk/main.js                        boot(); applyView(view)
  kiosk/views/kiosk.js                  renderKiosk(view)
  kiosk/effects.js                      react(prev,next)
  kiosk/audio-engine.js                現ファイルを流用予定
  assets/
deploy/
  marugoto-bingo.service                専用ユーザー、Restart=always
  Caddyfile                            /はweb、/apiはNode
  backup.service
  backup.timer                         5分ごとsqlite3 .backup、別ディスク
  purge-images.service
  purge-images.timer
  env.example
docs/device-api.md                     第8節の機器担当向け版
```

main()は設定→DB→サービス→HTTP起動、SIGTERMで終了処理。buildAppはテストからも使う。関数名・引数の不整合は第15節で明示する。

## 11. 非機能要件と運用

アプリ停止時はsystemdが数秒で再起動し、draw_snapshotから継続する。画面再読込で回数・結果を初期化しない。5分ごとにSQLiteの.backupを別ディスクへ保存し、開場前・終了後も手動取得。画像フォルダは終了後に複製する。バックアップ保持数、復元手順、最大許容データ損失は未定義。

サーバーと会場PCの時計はNTPで合わせ、ISO 8601の+09:00で記録する。Linuxではchrony等を想定するが、Windows側の時刻同期手段は環境に合わせる。受付・出玉APIの応答300ms以内を目標に会場回線で実測する。目標の測定区間・百分位・負荷条件は未定義。

HTML・JS・CSSはUTF-8の適切なContent-Typeで配信する。HTTPSのみ、HTTPはHTTPSへ転送。CookieはHttpOnly・Secure・SameSite=Strict。パスコード、制御PCトークン、カードトークンを平文保存しない。QR claimの扱いは第15節。

カード発行・スタンプはIP単位で制限する。氏名・連絡先・生年月日は収集せず、アンケートは年齢区分のみ。カードと玉だけを写し、人物を写さない設置にする。画像保存期間はイベント終了後14日を既定案とし、主催と確定する。journaldはアプリログ、action_logは業務ログ。終了後CSV出力。

npmパッケージ取得に外向き通信が必要な構築案。better-sqlite3はネイティブモジュールで、環境によってコンパイラ・python3等が必要。Node.js・依存パッケージの具体的バージョンは未指定。構築前にOSと互換性を確認し固定する。

## 12. 受入試験

研究室サーバー上で模擬スクリプトと実端末を使う。原文では04・17・23・29をC2項目とし、31〜33の手入力を先に合格させる。ただし04・17・23はAPI模擬でも先行検証可能。以下01〜33は原文の試験内容を保持する。

01：N=2で白・緑・赤・白。白と緑のみ有効、赤1・白1が超過。機内数は4減る。

02：N=2で白・未判定・赤。2個目は保留、赤で置換せず発券不可。

03：orderUncertain:true。要確認で保留し、自動で有効玉を選ばない。

04：同一連番再送。200 duplicate:true、玉数・当選は増えない。

05：待機中出玉。未割当、次のセッションに入らない。

06：回収確認前に次受付。受付不可。

07：補充予定だけ登録。機内数不変、実施分のみ増える。

08：同じ作業IDで戻し2回。1回分だけ加算。

09：排紙エラー後再印刷。同じ券番号、景品確保1回分。

10：同じ券2回引換。2回目拒否。

11：白玉が景品数より少ない設定。設定・在庫画面に不足数。

12：景品残数0の色が機内にある状態で受付。停止し確認要求。

13：受付後に設定変更。拒否。

14：案内iPad消音。文字と大きな個数で同じ案内が読める。

15：同じデジタルカードを2台で同時受付。一方のみ成功、他方は使用済み拒否。

16：2台同時抽選で両方1等。残数2減、各セッションへ正しく付く。

17：連番を1つ飛ばす。409 SEQ_GAPとexpectedSeq、機器画面警告。

18：会場PCの台別心拍停止。15秒後に該当台のみ新規受付拒否。

19：抽選中アプリ再起動。同じ出玉・進行から再開。

20：案内iPad・受付画面再読込。回数・結果保持。

21：来場者Cookieでstaff/commands。403。

22：他サイトから状態変更要求。Origin検査で拒否。

23：検出から60秒後に出玉到着。要確認。

24：古いrevisionで色修正。409、画面最新化。

25：C1が紙マス1つ誤判定。iPadで修正・確定可能、元判定・修正後・理由が残る。

26：角が切られた紙カード。警告、理由なし受付不可。

27：iPadで色修正。同台の案内iPadが数秒以内に更新。

28：会場PC停止、手入力。抽選継続、手入力の入力元が残り、同一操作ID再送は二重にならない。心拍条件との矛盾を解決してから合否を定義する。

29：C1+C2×2を同じハブで同時撮影。30分間映像途切れ・読取取りこぼしなし。

30：補充予定時刻経過。台別に色・個数表示、実投入入力まで機内数不変。

31：N=2で白・緑・赤を手入力し確定。白・緑有効、赤超過。確定1回で会場PCから印刷。

32：色押し間違いで直前取消。機内数・景品確保復元、理由が履歴に残る。

33：低速回線iPadで色ボタン連打。押した回数分だけ記録、再送で二重にならない。revision競合との整合は第15節。

### 12.1 追加試験案（原文外・承認待ち）

34：C2から届く前に手入力へ切替、同じ現物の自動イベントが遅着。二重計上せず、所属と順序を確認できる。

35：Aセッションの未送信出玉がB受付後に到着。Bに誤割当しない。

36：古いbootIdの未送信列を保持して会場PC再起動。旧列と新列の順序・重複除去が維持される。

37：共有景品が残り1個の色を2台で同時に有効入力。一方だけ確保し、他方は不足保留。負数にならない。

38：手動運用モードで会場PC停止。承認済み条件に従ってiPad受付・手入力・手書き券発行・引換ができる。

39：印刷直後、結果通知前に会場PC停止。自動で成功と断定せず、同一券番号で人が再印刷判断できる。

40：同一operationIdの再送に古いrevisionを添付。初回成功結果を返し、二重実行も不要な409も起こさない契約を検証する。

41：ブースQR重複・別ブース同種別・定員到達。承認済みマス割当ルールどおり。

42：SQLiteバックアップから復元し、カード使用済み・玉・景品・印刷待ち・引換状態が整合する。

43：機器APIのOriginなしBearer要求は許可し、ブラウザCookie APIの不正Originは拒否する契約を検証する。

44：紙カードを別台で再提示。承認済みの紙カード識別・物理回収ルールで再受付を防ぐ。

45：発行・スタンプのIP制限下で複数来場者が同じ会場回線を使う。正当利用を過剰に止めない。

## 13. 未確定事項（原文を保持）

玉の手持ち総数と台別初期投入数。サブドメイン名、外部DNS、443受信許可、証明書取得方式と80番の要否。サーバーOS・バージョン、sudo、npm外向き通信。会場Wi-Fiかモバイルルーターか、会場PCとiPad4台の接続構成。

同文言3マスをブース固定にするか種別内の番号順にするか。⑤をカード受取時に達成とするかビンゴ受付時にするか。C1機種・設置・対象台切替、C2機種、ハブ・ポート構成。検出プログラムの言語・担当者、C1/C2のAPI送信対応時期。

プリンター機種、Windowsドライバー、58mm/80mm、日本語・QR印字。2台景品共有の承認。来場者がブースQRを読む方式か、ブース担当が来場者QRを読む承認方式か。紙イラストのデジタル配信利用条件。マップをデモ3D移植にするか展示マップアプリへのリンクにするか。画像14日保存の承認。assetsを含むデモ原本一式。

## 14. 日程と実装順

原文日程図の未提供埋め込み：`[embed: node/85ae18a3-ccb9]`。日別タスク・担当者・締切は提供されていないため、具体的日程を作成済みとは扱わない。

原文の優先順は、公開サーバー手続きを早めに開始し、紙カードだけでも抽選・発券できる受付画面を来場者画面より先に完成させること。手入力を先行し、その後C2自動読取を追加する。来場者画面が間に合わなくても紙運用で本番を成立させる。

実装順の提案は、重大な仕様衝突の解消、サーバー公開・DB・認証、純粋な抽選domainと試験、紙受付・手入力・景品共有、発券と手書き代替、案内SSE、デジタルカードとスタンプ、C1/C2統合、実機リハーサル・障害復旧確認とする。これは承認済み日程ではない。

## 15. 矛盾・不足・リスクと修正提案

以下は提示仕様同士の比較と実装上のレビューであり、確定済み仕様を勝手に上書きするものではない。

### C01 最優先：会場PC停止時の継続と心拍必須が衝突

第4節・試験28は会場PC停止後もiPad手入力で継続するとする。一方、同PCから15秒心拍が来なければ新規受付拒否であり、次の参加者を受け付けられない。進行中も通信断で止める記述がある。提案は台別の明示的な手動運用モードを設け、管理者が理由付きで切替し、iPadとサーバーの疎通を条件に受付を許可すること。会場PC障害、C2障害、会場全体の回線断を別状態にする。全体回線断はオンライン継続せず紙運用へ移る。

### C02 最優先：自動読取と手入力で同じ玉を二重計上できる

自動は(machineId,bootId,seq)、手入力はoperationIdで重複除去するが、異なる入力経路で同じ現物を記録した場合は防げない。提案は台ごとの入力モード、切替時の停止・現物照合、未送信列の排出/保留、対応付け手順を定義すること。自動結果の色修正は新しいmanualBallではなく既存ballIdへのcorrectBallにする。手入力と自動を無条件に同時加算しない。

### C03 最優先：遅着出玉を次の参加者へ誤割当する

ball-eventsにはsessionIdや抽選世代IDがない。受信時の進行中セッションへ割り当てると、前の参加者の遅着玉が次の参加者に入る。60秒未満の遅延でも起こる。提案はサーバー発行の受付世代IDを機器イベントに含め、切替時に受信済み境界を確認すること。機器が世代を取得できなかった玉は未割当・要確認とする。detectedAtだけで自動割当しない。

### C04 最優先：紙カードの一意識別がない

紙にも1枚1受付を要求するが、C1はマスと角しか読み取らずcardIdがない。DBで新しいpaperカード行を作るだけでは同じ現物の再提示を検出できない。角欠落も理由入力で通せるため強い保証にならない。提案は紙カード固有番号/QR、受付時の回収、または厳密な物理無効化手順を決めること。角切取りが「抽選後」だと受付直後の再提示も防げない。紙の完全な二重受付防止を実装済みと表現しない。

### C05 最優先：手書き券が引換条件を満たさない

会場PC停止時は手書き券を使う一方、redeemPrizeは「1回以上印刷済み」を要求する。提案は発行状態にmanualIssuedを追加し、権限者が券番号・理由・発行者を記録し、printedまたはmanualIssuedを引換条件にすること。オフライン紙券の番号衝突、共有在庫の配分、復旧後の照合も別途必要。

### C06 最優先：Origin一致を全APIへ強制すると機器送信が止まる

ネイティブ検出プログラムのBearer要求にブラウザOriginが付くとは限らない。提案はCookie認証のブラウザ変更APIにOrigin検証を適用し、機器APIは台別Bearer・スキーマ・レート制限で認証すること。機器APIでOriginをどう扱うか明示する。Originは機器の認証情報として使わない。

### C07 最優先：revisionと低速回線での連打が衝突

全操作が共有revisionを更新するため、同じrevisionの複数クリックや別台操作・C2イベントで409が発生し、試験33の「押した回数だけ記録」が成立しない。提案はクライアント操作キューで順次送信し、各クリックに別operationIdを付け、409時は最新状態と対象セッションを確認して安全な操作だけ再試行すること。取消・色修正・確定を盲目的に再試行しない。台別revision等への変更も候補だが、共有景品の原子性は維持する。

### C08 冪等再送とrevision検査の順序が未定義

初回成功後の応答だけ失われると、同一operationId再送は古いrevisionになる。先にrevision検査すると成功済みなのに409となる。提案は認証・操作内容一致の確認後、既存operationIdの結果を先に返し、新規操作だけrevisionを検査すること。冪等キーと結果の永続保存、同一キー別内容の拒否を定義する。

### C09 card-readsの重複保存先がない

readSeqは出玉seqと独立だが、device_events主キーにイベント種別がなく、machinesにもreadSeq列がない。両方を同じテーブルへ入れると衝突する。提案はcard_reads専用テーブル、またはstream_kindを主キーへ追加すること。確認待ち読取の寿命、上書き、確定済み再送の結果も定義する。

### C10 再起動後の旧bootIdキュー処理が未定義

再起動で新bootIdを作る一方、旧bootIdの未送信列も残る。machinesの単一boot_id/last_seqだけでは世代をまたぐ順序・受理条件が不明。提案は台・bootId・ストリーム別の受信進捗を保存し、旧列を先に処理する契約と新世代開始条件を定義する。保存済みイベントのbootIdを再起動時に書き換えない。

### C11 緊急停止解除と再開のAPIが分離されていない

要件は解除と再開を別操作とするが、handlersにはemergencyStop/resumeしかない。提案はclearEmergencyStopとresumeDrawingを分け、解除後の再開待ち状態を持つこと。停止中の出玉は記録を捨てず、要確認として扱う等の規則も必要。

### C12 結果確定時の出玉境界がない

「受け皿を空にした」後にも未送信C2イベントが残り得る。finalizeResultのDBトランザクションは、物理停止・回収・実印刷を原子的に実行できない。提案は入力の締切境界、機器キュー確認、物理回収チェック、確定後遅着の要確認経路を設けること。ソフト上の確定ボタンを物理的安全保証としない。

### C13 印刷実行通知と排紙成功が混在

原文は自動印刷結果通知と担当者による排紙成否記録を併記する。提案はqueued、dispatched、operatorConfirmed、failed等を分け、ブラウザから印刷処理を呼んだことだけで排紙成功と断定しないこと。2台分を1プリンターへ直列化し、ジョブID・再試行・再起動復旧を定義する。同一券番号の再印刷でも紙の重複自体は起こり得るため、引換はサーバーで1回に制限する。

### C14 種別QRとブース単位重複防止の整合が不足

種別共通QRだけでは、同じ種別の異なるブースを識別できず、3マスを別体験で埋めたか保証できない。stampsは(card_id,booth_no)なので、QRは固有ブースを特定し、そのブースにcategoryを持たせる設計が必要。boothsにcategory、stampsにcell_no等がない。提案はブース固有トークン→ブース→種別→空きマスの対応を保存すること。⑤の初期達成も保存方法を決める。

### C15 静的ブースQRは体験の承認を保証しない

来場者によるマスタップを廃止しても、静的QRの写真共有・遠隔読取でスタンプを得られる。1人1カードもCookie削除や別ブラウザで保証できない。提案は「不正を抑止する簡易方式」か「スタッフ承認で体験を確認する方式」かを運営が選ぶこと。自己申告を完全排除したと説明しない。

### C16 紙参加者のデジタルアンケート導線がない

アンケートAPIは来場者Cookieとcard_idに依存するが、紙カード参加者のスマホ紐付けが未定義。surveysのchild/parent/ratingと、画面の年齢区分・感想・同意も対応しない。提案は紙参加者の回答トークン、設問・選択肢・同意、感想保存列、お礼の対象・数量・在庫・1回制限を確定すること。計画案の一般/子ども人数を何で集計するかも決める。

### C17 景品不足時の解決と残数の意味が曖昧

残数が「総数−確保」か「総数−引換済み」か未定義。予約と引換で二重に減算しないよう、総数・確保済未引換・引換済・利用可能を分ける。景品不足保留の代替品・中止・返却・予約解除の権限と処理を決める。残り1個を2台で争う追加試験37が必要。

### C18 玉不足・負数・未解決玉の運用が不足

機内数0の色を入力した場合、未判定玉があるまま次受付する場合、未割当玉をどこへ戻すか、取消が現物取消ではなく入力訂正であることが未定義。提案は帳簿負数を無条件許可せず、現物と違えば停止・棚卸し・理由付き補正にすること。総手持ち数が機内・予備・有効保管・戻し待ち・未割当等へ保存される保存則を試験する。

### C19 確定事項と未確定事項が混在

景品共有、来場者QR方式、⑤初期達成、種別順埋めは本文で採用される一方、第13節で未確定。プリンターも80mm CSSと58/80mm未確定が混在。提案は決定ログに状態・決定者・日付を記録し、未決定を本番固定値にしない。

### C20 API・関数・画面契約の不一致

「操作はすべてPOST」とPUT設定APIが不一致。acceptPaperCard(count,...)はマス配列・元読取・修正理由を受け取れず、サーバーでライン検証できない。提案はreadIdと確定marks・理由を受け取る契約にすること。スタッフ登録、台選択、景品お礼、次参加者、棚卸し、設定版切替、再開のAPIやコマンドスキーマも不足する。印刷画面のURLと静的ファイル解決方法も定義する。

### C21 複数イベントのデータ分離が不足

eventsは次回複製を想定するが、cards/booths/stamps等にevent_idがなくdraw_snapshotもid=1固定。提案は本番は1DB1イベントと明示し、次回は別DBにするか、関連テーブルと一意制約をイベント単位に拡張すること。QRのMARUGOTO2026固定も将来のイベント分離に合わせる。

### C22 秘密情報の保存要件とclaimが不一致になり得る

カードトークンは平文保存しないとする一方、cards.claimはQRに含まれる受付用の秘密値として平文保存に見える。提案はCookieトークンとQR claimを別物として定義し、claimもハッシュ照合するか、署名付きQR等の再生成可能な方式を検討すること。ハッシュのみでは元のclaimを復元してQR表示できないため、発行・再表示の設計を同時に決める。ログ・CSV・SSEに秘密値を出さない。

### C23 IP制限、認証、権限の詳細不足

会場回線・携帯回線の共有IPで正当な多数利用者が制限され得る。提案はIPだけでなくカード単位等を組み合わせ、想定来場者数で試験すること。ログイン試行制限、セッション有効期限、パスコード長、台担当権限の保存、案内端末Cookieの保存・失効、発券専用roleも定義する。画像・監査・SSEの公開範囲を役割別に絞る。

### C24 バックアップと復元後の再受付リスク

5分ごとのバックアップでは、障害時に直近の使用済みカード・景品確保・引換記録が失われ得る。提案は許容損失時間、復元後の受付停止・現物照合、オフライン台帳の統合手順を決めること。画像とDBの復元時点差、保持世代、空き容量、復元訓練も必要。ログがあるだけで完全復元できるとは限らず、初期状態・設定版・全必要操作を記録する契約が要る。

### C25 公開条件と証明書の問題は別

証明書を大学から取得しても、外部DNS・443受信・大学ネットワークの公開許可がなければスマホから接続できない。80番の要否は証明書取得方式による。提案は公開可否、DNS、受信経路、証明書方式、大学の運用許可を別項目として確認すること。未確定のホスト名を本番URLとして配布しない。

### C26 SSEと更新範囲・時刻依存表示が不足

全体revisionや全量SSEは別台操作でも競合・転送を増やす。補充予定時刻到達は業務操作がなくても画面更新が必要。提案は台別projection、必要最小限の配信、再接続時の全量再取得、時刻到達通知または定期再計算を定義すること。生存通知だけでは表示更新を保証しない。Caddy経由のSSEタイムアウトも実環境で試験する。

### C27 未提供資料と日程は実装可能情報ではない

v1.0本文、H01〜H06、デモ原本、埋め込み図3件、日別日程は未提供。提案は取得できるまで推測を仕様化せず、今回提供された業務規則と画像記述で実装可能な範囲を先行すること。C2を本番対象から外す場合は、原文の範囲変更として運営承認を取る。

## 16. Claude Codeが着手前に返す内容

既存コードと本書の差分、C01〜C07の解消案、未決定で実装が止まる事項、手入力先行の最小実装範囲、追加が必要なDB migrationとテストを提示する。実装を進める場合は、原文の確定要件を維持し、提案採用による変更は決定ログに残す。仕様がない機器制御・安全動作・不正防止保証を勝手に追加したり、実機試験前に本番合格と表現したりしない。

## 17. 出典と整理方針

出典A：ユーザーが会話本文に提示した「まるごと体験ビンゴ ソフトウェア仕様書（研究室サーバー版）」、2026-10-22、全14節。出典B：添付計画案TXT（開催日・準備日・会場・目的・課題）。出典C：添付紙ビンゴカード画像（文言・配置・装飾）。出典D：添付景品表画像（等級・色・景品・数量）。参照URLは第0節に記載し、今回取得できなかったことを明示した。

本統合ではHTMLの表示用タグと欠落した埋め込みを実装要件から分離し、全14節、API例、ファイル・関数構成、受入試験01〜33、未確定事項を単一ファイルへ整理した。追加試験34〜45と第15節の修正提案は本統合時のレビューであり、主催者承認済みではない。


## 18. 追加確定要件：会場Webマップ（2026-10-22追記）

### 18.1 今回の追加指示と既存記述への優先順位

ユーザーはデモ原本を入手できなかった。デジタルビンゴカードに加え、会場Webマップも必要であることを明示した。各ブースをタップすると詳細を表示し、ステージをタップするとステージのタイムラインを表示する。添付スクリーンショット`image.png`を外観・配置の参考とする。ユーザーが指摘した文字サイズの不具合は再現しない。

本節は第9節・第13節のマップ関連記述を更新する。「外部展示マップアプリへのリンクだけで要件を満たすか」は未決定扱いを終了し、本システム内で閲覧・操作できる会場Webマップを必須とする。外部リンクのみへの置換は、ユーザーの別途承認がない限り不可。立体表示（3Dの会場Webマップ）は必須である。描画ライブラリは未確定であり、画像だけを根拠に特定技術を採用しない。原本がないため、既存3Dコードの移植を前提にせず新規実装可能な構成にする。

### 18.2 画像から確認できるデザイン参考情報

淡い灰緑色の背景に、白い会場敷地とホール平面を斜め上から見たような俯瞰図が配置されている。ホール外周は淡い緑系の線、ブースは淡い緑・青・桃・黄などの直方体風の台で表現され、白系の名称ラベルが重なる。ホール上側に横長のステージ、その手前に小さい長方形の座席状の並び、中央に複数列のブース、下側に入口・販売・案内等、左側に屋外の区画がある。右上にはマイナス記号と家形の操作ボタンが見える。画像だけでは、ほかの操作ボタンやジェスチャーの実装有無は確認できない。

読み取れる主なラベルは「ステージ」「ミニ四駆」「木育体験」「スカットボール」「折り紙」「ランタン」「スマス」「フォト」「フォトスポット」「防災体験」「マンカラ」「贈る言葉」「似顔絵」「総合案内」「景品交換所」「アンケート」「入口」「おはぎ販売」「大垣城ホール」「だいこう列車」「グラウンドゴルフ」「屋外」など。ほかに「古布」「ブローチ」「フラワー」「おもちゃ」「病院」等の文字が見えるが、重なりのため正式なブース名や区切りは確定できない。読み取れたラベルも正式名称・当日出展・位置の承認済み一覧ではない。画像から推測した名称を本番データへ自動登録しない。

画像のラベル重複、過大な文字、余白の比率は改善対象。画像の外観を参考にすることと、配置・出展内容を正確な会場図として確定することは区別する。スクリーンショットのピクセル座標を実際の寸法や通路幅とみなさない。

### 18.3 必須の操作と表示

来場者画面から会場マップを開ける。カードとマップを往復してもカードの識別Cookieやスタンプ状態を失わない。マップの閲覧・ブース詳細・ステージ予定の閲覧はカード発行やスタッフログインを必須にしない案とする。公開範囲は個人情報を含まない運営承認済み情報に限る。

各ブースの図形または名称ラベルをタップすると、同じブースIDに対応する詳細を開く。スマホではボトムシートまたはダイアログ等で表示し、閉じる操作を用意する。表示方式は実装提案であり、タップで詳細を表示することが確定要件。詳細を閉じた際はマップの拡大率・表示位置を保つ。

ブース詳細は正式名称、主催・出展団体、紹介文を基本とする。開催時間、場所、対象、参加条件、定員、費用、スタンプ対象種別は運営から提供された項目だけを表示する。情報が未提供なら「未登録」「運営確認中」等を表示し、架空の値を補わない。ブース詳細を開いただけでスタンプを付与しない。スタンプ付与は第2節・第13節の承認済み方式に従う。

ステージ図形または「ステージ」ラベルをタップすると、当日のステージプログラムを時刻順のタイムラインで表示する。開始時刻、終了時刻（提供された場合）、演目名、出演団体等の公開情報、説明を表示できる構造にする。演目の実データは未提供であり、具体的な時刻・演目を作らない。予定未登録の場合は空欄ではなく「ステージ予定は準備中です」と表示する。時刻はイベント当日の日本時間として扱う。

縮小・拡大と全体表示への復帰を用意する案とする。画像で確認できるマイナスと家形に加え、拡大ボタンの要否、パン、ピンチ、回転の採否は未確定。操作ボタンは意味が分かる名前を付け、家形は「会場全体を表示」等のラベルを持たせる。誤タップ防止のため、マップ移動とブース選択を区別する。

### 18.4 文字・スマホ対応の要件

文字は画面上で読める大きさにし、ブースの立体表現に合わせて極端に拡大・縮小しない。ラベルの重なりを避け、全体表示では短縮名や選択中のみの強調等を検討する。正式名称は詳細画面で必ず確認できるようにする。名称を小さくして詰め込むだけの解決はしない。

色だけでブース種別を区別しない。文字と背景に十分なコントラストを確保する。マップ図形のタップ領域を文字サイズと独立に確保する。詳細画面とタイムラインはスマホ幅で折り返し、横にはみ出さない。ボタン操作・キーボード操作でも詳細へ到達できるようにする。

図だけでは目的のブースを見つけにくい場合に備え、ブース一覧から同じ詳細を開ける代替導線を設ける案とする。立体表示を通常の必須画面とし、表示できない端末ではブース情報・ステージ予定を確認できる補助的な一覧表示を検討する。補助表示を用意しても、立体マップの実装を省略してはならない。

### 18.5 データモデル追加案（承認待ち）

既存boothsのbooth_no、name、organizer、description、x、y、w、hを活用する。描画上の識別とスタンプ判定を分け、位置・寸法の座標系、原点、単位、ホール内外の扱いを明文化する。ブースにcategory、short_name、map_color、public_details_json等を追加する案。費用・定員等を追加する場合は型・未登録値・公開範囲を決める。

ステージはブースと異なる種別として識別できるようにする。例えばmap_placesにplace_idとkind(booth/stage/facility/outdoor)を持たせるか、既存boothsを拡張するかを実装前に決める。景品交換所・総合案内・入口等は体験ブースではないため、すべてをスタンプ対象として扱わない。

ステージ予定のテーブル案：stage_programs(program_id, event_id, stage_id, title, organizer, starts_at, ends_at, description, sort_order, status)。event_idの扱いは第15節C21の単一イベントDB/複数イベント方式の決定に合わせる。終了時刻がない場合の表現、時間重複の許否、休憩、変更・中止表示は未確定。来場者へスタッフ専用情報を配信しない。

### 18.6 HTTP API・ファイル追加案（承認待ち）

既存GET /api/boothsを公開ブース一覧・配置に使い、詳細を一覧応答へ含めるか、GET /api/booths/:idを追加するか決める。ステージ予定はGET /api/stages/:id/programs等の公開APIを追加する案。施設を含む会場全体の配置データはGET /api/map等へ分離する案。パス名は原文で未確定のため、既存コード調査後に統一する。

管理者がブース詳細・配置・ステージ予定を更新する場合は、管理API、入力検証、権限、操作ログを追加する。ステージ予定をJSONで事前登録する最小実装も選択肢だが、当日変更の反映方法を決める。SSEによるリアルタイム更新は今回必須とされていないため、必要性を確認せず複雑化しない。

web/visitor/views/map.jsのrenderMap(booths)、mountMap()に加え、ブース詳細とステージタイムラインの描画・開閉・選択処理を設ける。必要に応じmapDetail.js、stageTimeline.jsへ分割する。描画ライブラリの有無と依存パッケージは未確定。必須の立体表示を実装する際は、既存の「ビルド工程なし」と配布・依存管理方針が整合するよう設計する。

### 18.7 追加受入試験

M01：カード画面からマップへ移動し、カードへ戻る。カードID・達成マス・抽選済み状態が維持される。

M02：ブースの図形とラベルをそれぞれタップする。同じ正しいブースの詳細が表示され、別ブースの内容が混ざらない。

M03：詳細を閉じる。元の拡大率・表示位置へ戻り、別ブースを選択できる。

M04：ステージをタップする。提供済み演目が開始時刻順に並び、ブース詳細ではなくタイムラインが表示される。

M05：予定データが空。準備中の案内を表示し、架空の演目や時刻を表示しない。

M06：狭いスマホ画面で長いブース名・紹介文・演目名を表示する。文字が切れず、詳細とタイムラインを読め、閉じるボタンを操作できる。

M07：全体表示・拡大表示で確認する。画像の文字サイズ不具合を再現せず、名称の重なりで主要ブースが選択不能にならない。

M08：ブース詳細を開閉する。スタンプが勝手に増えず、抽選回数も変わらない。

M09：カード未発行の状態で公開マップを開く。承認された公開範囲のブース・ステージ情報だけを閲覧できる。

M10：ブース一覧やキーボード操作を使う。図の直接タップ以外でも必要な詳細へ到達できる。

M11：景品交換所・総合案内・入口等を選択する。施設として案内され、誤って体験スタンプ対象にならない。

M12：管理者が予定を変更した後、決められた再取得手順を実行する。最新予定を表示し、変更前の内容を確定情報として残さない。

### 18.8 追加で必要な運営データ

正式な会場配置図、全ブースのID・正式名称・主催・紹介文、スタンプ対象種別、施設一覧、屋外区画の扱い、ステージ演目の開始/終了時刻・名称・公開可能な団体名、当日変更担当者が必要。画像から読み取れない名称・重なったラベル・正確な配置は確認待ちとする。

今回確定したのは「会場Webマップが必要」「ブースタップで詳細」「ステージタップでタイムライン」「文字サイズ不具合は改善する」という機能要件である。立体表示は必須である。ただし参考画像の完全再現、全ラベルの正式名称、詳細内容、当日タイムテーブルは未確定である。


## 19. 追加決定：立体会場Webマップを必須とする

2026-10-22、ユーザーが「立体が必須」と明示した。本節は、第13節・第15節・第18節を含む旧記述のうち、立体表示の採否を未確定とする記述に優先する。

会場Webマップは、参考画像のように会場を斜め上から見渡し、ブース・ステージ等の高さや奥行きが分かる立体表示を必須とする。平面図だけの実装、静止した参考画像の表示だけ、外部マップへのリンクだけでは要件を満たさない。ブースをタップすると詳細を表示し、ステージをタップすると時刻順のタイムラインを表示する。

立体表示の採用は確定したが、描画ライブラリ、カメラの自由回転、傾き変更、アニメーション、実寸の建築モデル、写実的な質感までは要求されていない。これらを必須機能として追加しない。参考画像の立体的な俯瞰構成を基準にし、文字の過大表示や重なりは再現しない。

ブースの立体形状と名称ラベルは同じIDへ紐付け、どちらをタップしても同じ詳細を開く。ラベルは読みやすさを優先し、奥行きや拡大率に伴って読めなくならないようにする。補助的なブース一覧や障害時の代替表示は許可するが、通常画面の立体マップを平面図や一覧へ置き換える理由にはしない。

M13：通常の会場マップ画面を開く。会場を斜め上から見渡せ、ブースとステージの高さ・奥行きが視覚的に分かる。平面図または静止画像だけでは不合格。

M14：立体表示上のブースとステージをそれぞれタップする。正しいブース詳細とステージタイムラインが表示される。

M15：実際に使用するスマホとiPadで立体表示・タップ・詳細開閉を確認する。主要ブースを選択でき、ラベルの重なりや極端な文字サイズで操作不能にならない。対象機種と性能の数値基準はリハーサル前に決める。
