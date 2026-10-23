# 会場PC 検出プログラム向け API（§8 の実装版）

認証は台ごとの `Authorization: Bearer <token>` です（`scripts/issueDeviceToken.js` で発行）。Originヘッダーは不要で、認証にも使いません（C06）。本文の `machineId` はトークンの台と一致しなければ403です。1台につき毎分600要求を超えると429になります。

## 共通の再送規則

出玉は `(machineId, bootId, seq)`、カード読取は `(machineId, bootId, readSeq)` で一意です。`bootId` は検出プログラム起動ごとのUUIDで、`seq` と `readSeq` は起動ごと、種類ごとに1から始まる独立の連番です。前の応答を受け取ってから次を送ります。通信エラー、タイムアウト、5xxは同じ内容で1秒、2秒、4秒と間隔を延ばし、最大10秒間隔で再送し続けます。送信待ちはディスクに保存し、再起動後も同じ `bootId` と連番で送り直してください。古い `bootId` の列は保存時の値のまま送り、書き換えないでください。

| 応答 | 意味 | 検出プログラムの動作 |
|---|---|---|
| 200 `duplicate:false` | 新規に記録 | 次の連番へ |
| 200 `duplicate:true` | 同じ内容を受信済み（初回と同じ結果を返す） | 次の連番へ |
| 409 `SEQ_GAP` `expectedSeq` | 連番が飛んだ | `expectedSeq` から送り直す |
| 409 `DUPLICATE_KEY_DIFFERENT_PAYLOAD` | 同じ連番で別内容 | 送信停止、担当者へ警告 |
| 401 / 403 | トークン不正、別台ID | 送信停止、警告 |
| 422 | 形式不正 | 送信停止、警告 |

## 受付世代（C03 の暫定実装）

`GET /api/device/v1/state` は `generation`（進行中の抽選の券番号、待機中は `null`）を返します。出玉を検出した時点の `generation` を記録し、出玉イベントに入れて送ってください。進行中の世代と違う出玉は、次の参加者に割り当てず「未割当」になります。`generation` がない出玉は、進行中の抽選に「要確認」として入り、担当者の確認が必要です。台が手入力モードの間に届いた出玉は記録だけ残し、在庫にも当選にも数えません（C02）。

## エンドポイント

`POST /api/device/v1/ball-events`

```json
{ "machineId": "garagara-1", "bootId": "0b6f4c5e-2f7a-4f3e-9b1d-8e2a1c9d7f40", "seq": 42,
  "generation": "BM-0003", "detectedColor": "green", "confidence": 0.91, "orderUncertain": false,
  "detectedAt": "2026-11-01T10:15:30.123+09:00", "imageId": "img_..." }
```

`detectedColor` は `red`、`green`、`lightblue`、`white`、または色が不確実なとき `null` です。順番が不確実なら `orderUncertain: true` にします。検出から60秒以上たって届いた出玉は要確認になります。

`POST /api/device/v1/card-reads`：紙は `kind:"paper"`、`cells`（9要素、確信がないマスは `null`）、`cornerPresent`。デジタルは `kind:"digital"` と `qrPayload`（カードQRの文字列）。QRの秘密値は受信時に検証し、DBには保存しません。新しい読取が届くと、その台の確認待ちの読取は置き換わります。

`POST /api/device/v1/images`：本文は `image/jpeg`、300KB以下。応答の `imageId` を出玉や読取に入れます。人物が写らない設置にしてください。

`POST /api/device/v1/heartbeat`：`{ machineId, bootId, lastSeq, cameraOk, sensorsOk, at }` を5秒ごとに送ります。15秒届かない台は「心拍なし」になります。

`GET /api/device/v1/state`：`{ phase, inputMode, stopped, generation, sessionId, n, count, serverTime }`。

実機の前は `scripts/simulateDevice.js` で同じAPIを試せます。
