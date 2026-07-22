# 複数LLMプロバイダー・ルーティング設計仕様書

日付: 2026-07-22
ステータス: レビュー待ち

## 1. 目的

同じ街のLLM管理住民を、Claude Code CLIまたはCodex CLIへ住民単位で決定的に振り分ける。これは障害時のプロバイダー間フォールバックではない。複数プロバイダーに割り当てられた住民が同じシミュレーション内で共存し、それぞれの割当先から計画を得るためのルーティング機能である。

達成する状態:

- `Ash`はClaude、その他の現在および将来の住民はCodex、という構成を1つの環境変数で指定できる。
- 各住民の割当先は起動中にランダム変動せず、同じ設定には常に同じプロバイダーが対応する。
- Claudeの割当住民とCodexの割当住民を同時にLLM管理対象にできる。
- 画面上で、住民の割当プロバイダーと直近計画の生成元を区別できる。
- 片方のプロバイダーが失敗しても、もう片方に割り当てられた住民は通常どおり計画できる。

## 2. スコープ外

- Claude失敗時にCodexへ切り替えるなどの、プロバイダー間フォールバック
- 負荷、価格、レート制限、応答品質に基づく動的ルーティング
- 起動中の設定変更や管理画面からの再割当
- プロバイダーごとの同時実行キュー
- APIキーを直接使うSDK統合
- Claude/Codex以外のプロバイダー追加

既存の単一グローバル思考キューは維持する。複数プロバイダーは同じ街で利用されるが、LLMプロセスの同時実行数を増やすことは本変更の目的ではない。

## 3. 設定契約

### 3.1 `LLM_AGENTS`との責務分離

- `LLM_AGENTS`は、どの住民をLLM管理対象にするかを選ぶ。
- `LLM_ROUTES`は、選ばれた住民をどのプロバイダーへ送るかを決める。
- ルーティングはFakePlannerを管理対象に加えない。LLM管理対象外の住民は従来どおりFakePlannerだけを使う。

### 3.2 構文

```sh
LLM_AGENTS=all
LLM_ROUTES='Ash:claude,*:codex'
```

`LLM_ROUTES`は、カンマ区切りの `<selector>:<provider>` である。

- `selector`: 大文字小文字を区別する住民名、またはワイルドカード `*`
- `provider`: `claude` または `codex`
- 名前の完全一致ルートを最優先し、一致しなければ `*` を使う。
- 空白は各項目とコロン両側で除去する。
- 設定が未定義なら `*:claude` と等価に扱い、従来挙動を保つ。
- 定義済みだが空文字の設定は、誤設定として拒否する。

例:

```sh
# 全LLM住民をClaudeへ送る（未設定時と同じ）
LLM_ROUTES='*:claude'

# AshだけClaude、その他と将来の移住者はCodex
LLM_ROUTES='Ash:claude,*:codex'

# 選択した2人を異なるプロバイダーへ送る
LLM_AGENTS='Ash,Birch'
LLM_ROUTES='Ash:claude,Birch:codex'
```

### 3.3 起動時検証

LLMプランナーが有効な場合、次を起動エラーにする。

- 不明なプロバイダー名
- 空の項目、セレクター、またはプロバイダー
- 同じ住民名または `*` の重複
- 現在の世界に存在しない住民名の完全一致ルート
- 現在のLLM管理対象住民に解決可能なルートがない
- `LLM_AGENTS=all` なのに、将来の移住者を解決する `*` がない

既知だが現在はLLM管理対象外の住民に対するルートは許可する。`LLM_PLANNER`が無効なら、未使用のLLM設定は解釈しない。

## 4. ドメイン状態と表示上の意味

共有型に次を追加する。

```ts
export type LlmProvider = "claude" | "codex";

export interface AgentState {
  // existing fields...
  llmProvider: LlmProvider | null;
}
```

`planSource`と`llmProvider`は意味が異なる。

| 状態 | 意味 |
|---|---|
| `planSource: "fake"`, `llmProvider: null` | LLM管理対象外 |
| `planSource: "llm"`, `llmProvider: "claude"` | Claude割当で、直近の採用計画もClaude製 |
| `planSource: "llm"`, `llmProvider: "codex"` | Codex割当で、直近の採用計画もCodex製 |
| `planSource: "fake"`, `llmProvider: "claude"` | Claude割当だが、直近はルールベース安全網へ退避 |
| `planSource: "fake"`, `llmProvider: "codex"` | Codex割当だが、直近はルールベース安全網へ退避 |

`llmProvider`は「直近に成功したプロバイダー」ではなく、現在のルート割当を表す。したがって、プロバイダー呼び出しが失敗してFakePlannerの計画を採用しても値を保持する。LLMプランナー無効時とLLM管理対象外住民は`null`である。

初期住民にはブローカー初期化時、新規移住者には管理対象として初めて観測した時点で割当を反映する。割当はシミュレーションの判断材料にはせず、サーバーのルーティングとクライアント表示にだけ使う。

## 5. サーバー設計

### 5.1 汎用ランナー境界

Claude固有名になっているランナー境界を汎用化する。

```ts
export type RunnerResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export interface LlmRunner {
  run(prompt: string): Promise<RunnerResult>;
}
```

- `CliClaudeRunner`と新しい`CliCodexRunner`は同じ`LlmRunner`を実装する。
- `LlmPlanner`はランナーとプロバイダーIDを受け取る。
- ClaudeとCodexに対して各1個の`LlmPlanner`を構築し、プロバイダー・レジストリに保持する。
- `ThoughtBroker`の計画要求時に住民のルートを解決し、対応するプランナーを選ぶ。
- FakePlanner、計画JSONの解析、正規化、実行可能性検証は両プロバイダーで共有する。

プロバイダー・ルーターは不変の設定値を保持し、`providerFor(agent)`を決定的に返す。ランダム選択、ラウンドロビン、直近障害による書き換えは行わない。

### 5.2 Claudeランナー

既存契約を維持する。

```sh
claude -p --output-format json
```

標準入力へ計画プロンプトを渡し、ラッパーJSONの`result`文字列を計画レスポンスとして返す。既存のタイムアウト、非ゼロ終了、spawn失敗の処理を維持する。

### 5.3 Codexランナー

Codex CLIは非対話かつプロジェクトから隔離して起動する。

```sh
codex exec \
  --ephemeral \
  --ignore-user-config \
  --ignore-rules \
  --sandbox read-only \
  --skip-git-repo-check \
  --color never \
  --json \
  -
```

- `-`により標準入力から計画プロンプトを読む。
- `--ephemeral`によりセッション履歴を永続化しない。
- `--ignore-user-config`によりユーザーの`config.toml`を読み込まない。ただし認証は通常の`CODEX_HOME`を使う。
- `--ignore-rules`と中立な一時ディレクトリの作業ディレクトリにより、ゲームリポジトリの指示やファイルを計画生成へ混入させない。
- `--sandbox read-only`により、モデルがコマンドを要求してもファイル変更を許可しない。
- `--json`のJSONL出力から、正常完了した最後の`item.completed`かつ`item.type === "agent_message"`の本文を抽出する。
- `turn.failed`、トップレベル`error`、壊れたJSONL、agent messageなし、非ゼロ終了、spawn失敗、タイムアウトはランナー失敗として返す。
- CLIのstderrは成功レスポンスに混ぜず、失敗時の診断だけに使う。

CLI引数とJSONL形状はテストで固定し、実機スモークでも現在インストール済みCLIとの互換性を確認する。CIは実CLIを起動しない。

### 5.4 再試行とルールベース安全網

各`LlmPlanner`は現在と同じく最大2回試行する。

1. 割り当てられた同一プロバイダーを呼ぶ。
2. 出力を解析、正規化、実行可能性検証する。
3. 失敗時は同じプロバイダーでもう1回だけ試す。
4. 2回とも失敗したらFakePlannerの計画を採用する。

ClaudeからCodex、CodexからClaudeへの切り替えは行わない。これにより、ルート設定と実際の送信先が一致し続ける。

### 5.5 ログ

構造化ログへ最低限次を含める。

```json
{"at":"llmPlanner","agent":"agent-1","provider":"claude","attempt":1,"outcome":"llm"}
```

失敗時は`outcome: "error"`と診断文字列を含める。FakePlanner採用時は`outcome: "fake"`を1行記録する。プロンプト本文や認証情報はログへ出さない。

## 6. クライアント表示

住民の吹き出しと詳細パネルは、割当と直近計画元を次のように表示する。

- LLM管理対象外: `FAKE`
- Claude割当でLLM計画採用中: `CLAUDE`
- Codex割当でLLM計画採用中: `CODEX`
- Claude割当だが安全網の計画を採用中: `CLAUDE → FAKE`
- Codex割当だが安全網の計画を採用中: `CODEX → FAKE`

既存の金色リングは`planSource === "llm"`の意味を維持する。プロバイダー種別でゲーム上の能力差や優劣を示す色分けは追加しない。

## 7. エラー分離と運用

- 一方のCLIが未インストール、未認証、レート制限中でも、失敗はそのプロバイダーに割り当てられた要求だけへ閉じる。
- その要求は2回失敗後にFakePlannerへ退避し、思考キューを解放する。
- 別プロバイダーに割り当てられた後続要求は通常どおり処理する。
- 起動時にCLIの存在や認証を先読み検査しない。未使用プロバイダーまで起動不能にせず、実際の要求結果を構造化ログで観測する。
- `LLM_ROUTES`の構文・網羅性エラーだけは起動時に失敗させ、暗黙の別プロバイダー選択は行わない。

## 8. テスト戦略

すべてRed → Green → Refactorで進める。

1. 共有状態: `llmProvider`の初期値、WebSocketのwelcome/update伝播。
2. ルート解析: 未設定既定値、完全一致優先、ワイルドカード、新規移住者、空値、重複、不明名、不明プロバイダー、網羅性不足。
3. 汎用ランナー: Claudeの既存回帰とCodexの引数、stdin、JSONL抽出、終了エラー、壊れた出力、タイムアウト。
4. プランナー・レジストリ: Claude住民はClaudeだけ、Codex住民はCodexだけを呼ぶ。
5. 障害分離: 同一プロバイダー2回失敗後にFakePlannerとなり、他方ランナーを呼ばない。次住民の要求は継続する。
6. 動的住民: `LLM_AGENTS=all`の新規移住者へワイルドカードが適用され、UI状態にも割当が現れる。
7. クライアント: `FAKE`、`CLAUDE`、`CODEX`、各安全網表示。
8. 実機スモーク: CI外でCodex単独、Claude単独、混在ルートを順に確認する。

実機スモークでは、ログの`agent`と`provider`、WebSocket状態の`llmProvider`と`planSource`、住民が受け取った実行可能タスクを照合する。

## 9. 受け入れ条件

- `LLM_ROUTES='Ash:claude,*:codex'`で、Ashの要求はClaudeだけへ、それ以外はCodexだけへ送られる。
- 将来の移住者が`*`ルートでCodexへ割り当てられる。
- Claudeが失敗してもCodexへ切り替わらず、AshだけがFakePlannerへ退避する。
- 同じ実行中、Codex割当住民は引き続きCodexから計画を得られる。
- UIで各住民の割当プロバイダーと安全網使用中を判別できる。
- 未設定時は全LLM住民がClaudeへ送られ、現在の起動方法を壊さない。
- `just check`、`just test`、クライアントproduction buildが成功する。
- 実CLIを使うスモーク以外の自動テストは、Claude/Codexプロセスを起動しない。

## 10. 採用しなかった案

### 安定ハッシュまたはラウンドロビン

設定量は減るが、住民とプロバイダーの対応が運用者にとって不透明になる。特定の人格を特定プロバイダーで観察する用途にも向かないため不採用。

### 動的負荷分散

稼働状況に応じて自動配分できる一方、再現性が落ち、フォールバックとの境界も曖昧になる。今回の「明示的ルーティング」と異なるため不採用。

### `planSource`を`claude | codex | fake`へ拡張

割当先と直近計画元を1フィールドに混ぜると、`CODEX → FAKE`の状態を表せない。既存のLLM対Fakeという意味も壊すため、独立した`llmProvider`を採用する。
