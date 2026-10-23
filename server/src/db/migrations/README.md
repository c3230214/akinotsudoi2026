# SQLite migrations

`NNN_name.sql` を番号順に1回だけ適用します（`src/db/connection.js runMigrations`）。適用済みファイルの内容はチェックサムで記録しており、書き換えると起動を拒否します。変更は新しい番号のファイルとして追加してください。
