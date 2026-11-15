# 秀丸風 背景マーカー（VS Code拡張機能）

選択範囲や指定した単語に複数色の背景マーカーを付けられるVS Code拡張機能です。
秀丸エディタのように、テキストやソースコードを読みながら気になったキーワードや文章を手軽に色分けハイライトし、素早くジャンプして巡回できます。

---

## 🌟 主な機能

* **複数色のマーカーハイライト**:
  * プリセット5色（🟡 黄色, 🟢 緑色, 🔵 水色, 🟣 ピンク, 🟠 オレンジ）
  * 🎨 自由なカラーコード指定（HEX, RGB, RGBA, HSL など）に対応。
  * **不透明度（濃さ）の調整**: VS Code の設定からマーカーの濃さを好みに応じて変更可能。
* **ワンタッチ着色**:
  * ショートカットキー1発で選択範囲やカーソル位置の単語を即座に着色。
* **メニューから柔軟に一括ハイライト**:
  * 選択範囲のみを塗る
  * 単語全体が完全一致する箇所をファイル内で一括ハイライト（日本語・英数字両対応）
  * 部分一致する箇所を一括ハイライト
  * 大文字・小文字の違いを無視（Case-Insensitive）して一括ハイライト
  * 任意の検索文字列を入力して一括ハイライト
* **📍 マーカー間ジャンプ（次へ / 前へ）**:
  * ハイライトされた箇所へキー操作で次々にカーソルを移動・自動スクロール（ループ移動対応）。
  * 隣接したマーカーもスキップせずに順番にジャンプ。
* **マーカー一覧表示・選択ジャンプ**:
  * ファイル内のマーカーを一覧（色・行番号・テキスト）でクイックピック表示し、Enterで即座に対象行へジャンプ。
* **重ね塗り・上書き**:
  * 既存のハイライトの上から別の色を塗った場合、重なった部分が新しい色に自動で切り替わります。
* **消しゴム・クリア機能**:
  * **選択範囲消しゴム**: 選択した部分だけをくり抜き消去。
  * **マーカー消去**: ハイライト上で消しゴムを押すと、そのマーカー全体を綺麗に1発消去。
  * **指定色クリア**: 特定の色（例: 黄色だけ）を選んで一括消去。
  * **ファイル内全クリア / 全ファイル全クリア**。
* **💾 ハイライトの永続化＆自動復元**:
  * ファイルを閉じたり、VS Codeを再起動しても、付けたハイライトが自動的に復元されます。
  * **ファイル名変更（リネーム・名前を付けて保存）** にも自動追従してハイライトを引き継ぎます。
* **📊 ステータスバー表示**:
  * エディタ右下に現在のファイルのマーカー件数（例: `🎨 5`）を常時表示。クリックでメニューがポップアップ。
* **マルチタブ・左右分割エディタ（Split Editor）完全同期**:
  * 同一ファイルを左右で分割表示していてもリアルタイムに同期します。
* **文字入力への高精度追従**:
  * テキストの編集、改行、削除、アンドゥ（Ctrl+Z）にもハイライト位置が安全に追従します。

---

## ⌨️ ショートカットキー一覧

| 機能 | Windows / Linux | macOS | コマンドID |
| :--- | :--- | :--- | :--- |
| **メニューから塗る** | `Alt + M` | `Cmd + Alt + M` | `hidemaru-highlighter.colorizeWithMenu` |
| **1発で塗る（🟡 黄色）** | `Alt + 1` | `Cmd + Alt + 1` | `hidemaru-highlighter.quickColor.yellow` |
| **1発で塗る（🟢 緑色）** | `Alt + 2` | `Cmd + Alt + 2` | `hidemaru-highlighter.quickColor.green` |
| **1発で塗る（🔵 水色）** | `Alt + 3` | `Cmd + Alt + 3` | `hidemaru-highlighter.quickColor.cyan` |
| **1発で塗る（🟣 ピンク）** | `Alt + 4` | `Cmd + Alt + 4` | `hidemaru-highlighter.quickColor.pink` |
| **1発で塗る（🟠 オレンジ）** | `Alt + 5` | `Cmd + Alt + 5` | `hidemaru-highlighter.quickColor.orange` |
| **消しゴム（選択範囲/カーソル位置）** | `Alt + 0` | `Cmd + Alt + 0` | `hidemaru-highlighter.eraseSelection` |
| **📍 次のマーカーへジャンプ** | `Alt + ]` | `Cmd + Alt + ]` | `hidemaru-highlighter.jumpToNext` |
| **📍 前のマーカーへジャンプ** | `Alt + [` | `Cmd + Alt + [` | `hidemaru-highlighter.jumpToPrev` |
| **マーカー一覧表示・ジャンプ** | `Alt + L` | `Cmd + Alt + L` | `hidemaru-highlighter.listHighlights` |

> **💡 ヒント**:
> * エディタ右上（タブの並び）にある **🎨 アイコン** または右下のステータスバーをクリックすることでもメニューを呼び出せます。
> * 右クリックのコンテキストメニュー「🎨 背景マーカー（色付け）」からも全機能を利用可能です。

---

## ⚙️ 設定方法（Settings & Customization）

本拡張機能は、マーカーの濃さやステータスバー表示、キーボードショートカット、ハイライト色などを柔軟にカスタマイズできます。

### 1. 基本設定（VS Code 設定画面 / settings.json）

#### GUI から設定する場合
1. `Ctrl + ,`（macOS: `Cmd + ,`）を押して VS Code の「設定」画面を開きます。
2. 検索ボックスに `hidemaruHighlighter` と入力します。
3. 該当する設定項目の値を変更します。

#### `settings.json` で直接設定する場合
`settings.json`（ユーザー設定またはワークスペース設定）に以下を記述します：

```json
{
  // マーカー背景色の不透明度（0.1: 薄め 〜 1.0: 完全に不透明、デフォルト: 0.4）
  "hidemaruHighlighter.opacity": 0.4,

  // エディタ右下のステータスバーに現在のファイルのマーカー件数を表示するかどうか
  "hidemaruHighlighter.showStatusBarItem": true
}
```

#### 設定項目一覧
| 設定項目 | 型 | デフォルト | 説明 |
| :--- | :--- | :--- | :--- |
| `hidemaruHighlighter.opacity` | `number` | `0.4` | マーカー背景色の不透明度（`0.1` 〜 `1.0`）。設定を変更すると、エディタ上で開いている全ハイライトの濃さに即座に反映されます。 |
| `hidemaruHighlighter.showStatusBarItem` | `boolean` | `true` | エディタ右下のステータスバーに現在のファイルのマーカー件数アイテム（例: `🎨 5`）を表示するかどうか。 |

---

### 2. キーボードショートカットのカスタマイズ設定

お好みのキーバインドに変更できます。

#### GUI から変更する場合
1. `Ctrl + K, Ctrl + S`（macOS: `Cmd + K, Cmd + S`）を押して「キーボード ショートカット」画面を開きます。
2. 検索バーに `hidemaru-highlighter` と入力します。
3. 変更したいコマンドをダブルクリック（または `Enter`）し、割り当てたいキーを押して `Enter` で確定します。

#### `keybindings.json` で直接変更する場合
コマンドパレット（`Ctrl + Shift + P`）から「基本設定: キーボード ショートカットを開く (JSON)」を選択し、以下のように設定を追加・編集します：

```json
[
  {
    "command": "hidemaru-highlighter.quickColor.yellow",
    "key": "alt+1",
    "mac": "cmd+alt+1",
    "when": "editorTextFocus"
  },
  {
    "command": "hidemaru-highlighter.colorizeWithMenu",
    "key": "alt+m",
    "mac": "cmd+alt+m",
    "when": "editorTextFocus"
  },
  {
    "command": "hidemaru-highlighter.eraseSelection",
    "key": "alt+0",
    "mac": "cmd+alt+0",
    "when": "editorTextFocus"
  }
]
```

---

### 3. カスタムカラーの指定・設定

プリセットの5色（黄色、緑色、水色、ピンク、オレンジ）以外にも、自由な色を指定してマーカーを引くことができます。

1. マーカーを塗りたいテキストを選択するか、カーソルを単語の上に置きます。
2. `Alt + M`（macOS: `Cmd + Alt + M`）を押してメニューを開きます。
3. メニュー最下部の **「🎨 自由なカラーコードを入力...」** を選択します。
4. 入力ボックスに、任意の CSS カラー形式を入力して `Enter` を押します：
   * **HEX 形式**: `#FF5722`、`#FF980080`（透明度付き8桁HEXも対応）
   * **RGB / RGBA 形式**: `rgb(255, 87, 34)`、`rgba(33, 150, 243, 0.5)`
   * **HSL / HSLA 形式**: `hsl(210, 100%, 56%)`、`hsla(120, 100%, 25%, 0.4)`
   * **カラー名**: `gold`、`tomato`、`coral`、`skyblue`、`crimson` など

---

## 🛠️ デバッグ方法（Debugging Guide）

VS Code の拡張機能開発環境（Extension Development Host）を使用して、ブレークポイントやステップ実行、リアルタイムなコード反映（ホットリロード）を行いながらデバッグできます。

### 1. 開発環境のセットアップ
事前に [Node.js](https://nodejs.org/)（v18 以上推奨）がインストールされていることを確認し、プロジェクトルートで依存パッケージをインストールします：

```bash
npm install
```

### 2. デバッグの開始（F5 実行）
1. VS Code で本プロジェクトフォルダを開きます。
2. **`F5` キー** を押します。
   * または、左側アクティビティバーの「実行とデバッグ」アイコンをクリックし、構成が **`Run Extension`** になっていることを確認して緑色の再生ボタン（`▷`）をクリックします。
3. `.vscode/launch.json` と `.vscode/tasks.json` に基づき、バックグラウンドで TypeScript コンパイラ（`npm run watch`）が自動起動し、トランスパイル完了後に新しいウィンドウ **「[拡張機能開発ホスト] (Extension Development Host)」** が立ち上がります。

### 3. デバッグホストでの動作確認
1. 起動した「拡張機能開発ホスト」ウィンドウで、適当なテキストファイルやコードを開きます（または新規ファイルを作成）。
2. 文字列を選択し、ショートカット（`Alt + 1` 〜 `Alt + 5`）や `Alt + M` のメニュー、右クリックコンテキストメニューからマーカー機能をテストします。

### 4. ブレークポイントの設定とステップ実行
1. 親ウィンドウ（開発元の VS Code）で `src/extension.ts` を開きます。
2. 調査したい処理の行番号の左側をクリックして、**赤丸（ブレークポイント）** を設置します（例: `colorizeSelection` や `jumpToNext` 関数内など）。
3. 拡張機能開発ホスト側で該当のハイライト操作を実行します。
4. 設定した行で処理が一時停止し、親ウィンドウ側で以下を確認・操作できます：
   * **変数（Variables）**: ローカル変数やスコープ内の値の確認
   * **コールスタック（Call Stack）**: どの関数から呼び出されたかの追跡
   * **ステップ操作**: ステップオーバー（`F10`）、ステップイン（`F11`）、ステップアウト（`Shift + F11`）、続行（`F5`）

### 5. デバッグコンソール（Debug Console）の活用
* 親ウィンドウ下部の **「デバッグ コンソール」**（`Ctrl + Shift + Y` / macOS: `Cmd + Shift + Y`）で、`console.log` の出力やエラーログを確認できます。
* デバッグコンソールの入力欄に変数を入力して `Enter` を押すと、一時停止中のコンテキストにおける変数の値や式の評価結果を即座に確認できます。

### 6. コード変更の即時反映（ホットリロード / リロード）
* `src/extension.ts` を編集して保存すると、バックグラウンドの `npm run watch` が自動で再コンパイルを行います。
* **拡張機能開発ホスト側のウィンドウで `Ctrl + R`（macOS: `Cmd + R`）を押す**か、コマンドパレット（`Ctrl + Shift + P`）から **`Developer: Reload Window`** を実行します。
* 開発ホストウィンドウを一度閉じて `F5` を押し直すことなく、数秒で最新の変更が反映されます。

### 7. デバッグの終了
* 親ウィンドウ上部のデバッグツールバーの **「停止（赤色の四角アイコン）」** をクリックするか、**`Shift + F5`** を押すとデバッグセッションが終了します。

### 8. トラブルシューティング
* **ビルドエラーが発生してデバッグが起動しない場合**:
  ターミナルで `npm run compile` を実行し、TypeScript のコンパイルエラー箇所を確認してください。
* **拡張機能が正しくロードされない場合**:
  `out/extension.js` が生成されているか確認してください。存在しない場合は `npm run compile` を手動実行してください。

---

## 📦 拡張機能の作成・ビルド・パッケージング方法

本拡張機能のコード構成と、配布・インストール用の `.vsix` パッケージを作成・利用する方法です。

### 1. プロジェクト構成と仕組み
* **`package.json`**:
  * 拡張機能のメタデータ（名前、バージョン、ライセンス等）。
  * `contributes`: コマンド（`commands`）、メニュー配置（`menus` / `submenus`）、ショートカット（`keybindings`）、設定項目（`configuration`）を宣言。
* **`src/extension.ts`**:
  * 拡張機能のメインロジック。
  * **文字オフセット管理**: テキスト内の位置を行・桁ではなく `start` / `end` の文字オフセットで保持し、改行や文字挿入・削除時もハイライトが安全に追従。
  * **装飾レンダリング**: `vscode.window.createTextEditorDecorationType` を活用し、ハイライトの両端入力時のチラつきを防ぐ `rangeBehavior: OpenOpen` を採用。
  * **永続化**: `context.workspaceState` にハイライトデータを保存し、VS Code 再起動時やファイル名変更時（`onDidRenameFiles`）に自動復元。
* **`tsconfig.json`**: TypeScript のコンパイル設定。
* **`.vscode/`**: VS Code のデバッグ（`launch.json`）およびタスク（`tasks.json`）設定。
* **`out/`**: トランスパイルされた JavaScript の出力先ディレクトリ。

### 2. ビルドコマンド

* **一括コンパイル（手動ビルド）**:
  ```bash
  npm run compile
  ```
  `src/` 配下の TypeScript が `out/` 配下の JavaScript (`extension.js`, `extension.js.map`) に出力されます。

* **変更監視コンパイル（ウォッチモード）**:
  ```bash
  npm run watch
  ```
  ファイル変更を監視し、保存されるたびに自動で増分ビルドします。

### 3. VSIX パッケージの作成（パッケージング）

VS Code 拡張機能の公式ツール `@vscode/vsce` を利用して、ローカルインストールや社内配布が可能な `.vsix` パッケージを作成します。

```bash
npm run package
```
または直接 npx で実行：
```bash
npx @vscode/vsce package
```

* コマンドを実行すると、ルートディレクトリに **`hidemaru-highlighter-0.2.0.vsix`**（バージョン番号付き）が生成されます。
* `package.json` の `vscode:prepublish` スクリプトにより、パッケージング直前に自動で `npm run compile` が実行されます。

### 4. 作成した拡張機能（.vsix）のインストール方法

生成された `.vsix` ファイルは、マーケットプレイスに公開せずとも以下の方法で誰でもインストールして使用できます。

#### 方法A: VS Code の GUI からインストール
1. VS Code を開き、左側のアクティビティバーから **「拡張機能」アイコン** をクリック（`Ctrl + Shift + X` / macOS: `Cmd + Shift + X`）。
2. 拡張機能ペインの右上にある **「…」（その他の操作）メニュー** をクリック。
3. メニューから **「VSIX からのインストール... (Install from VSIX...)」** を選択。
4. 生成された `hidemaru-highlighter-0.2.0.vsix` ファイルを選択します。
5. 右下にインストール完了通知が表示されれば、すぐに利用可能になります（VS Code の再起動は不要です）。

#### 方法B: コマンドライン（CLI）からインストール
ターミナルで以下のコマンドを実行します：

```bash
code --install-extension hidemaru-highlighter-0.2.0.vsix
```

---

### 5. （参考）新規に VS Code 拡張機能を作成する手順

ゼロから新しく独自の VS Code 拡張機能プロジェクトを作成する場合は、公式の Yeoman ジェネレーターを使用します：

1. **ジェネレーターの起動**:
   ```bash
   npx --package yo --package generator-code -- yo code
   ```
2. **対話形式でプロジェクト設定を選択**:
   * Type of extension: `New Extension (TypeScript)`
   * Extension name: 拡張機能の名前
   * Package manager: `npm`
3. **拡張機能のエントリポイント**:
   * 生成された `src/extension.ts` の `activate(context: vscode.ExtensionContext)` 関数内に機能（コマンド登録やイベントリスナー）を実装していきます。
   * `package.json` の `contributes` にコマンドやキーバインド、メニューを定義します。

---

## 📄 ライセンス

MIT License
