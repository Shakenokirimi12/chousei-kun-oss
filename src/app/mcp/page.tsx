import Link from "next/link";
import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
    title: `AIエージェント連携（MCP） - ${siteConfig.name}`,
    description: `${siteConfig.name}をClaudeなどのAIエージェントから操作するためのMCPサーバーの使い方`,
};

export const revalidate = 86400;

function CodeBlock({ children }: { children: string }) {
    return (
        <pre className="rounded-md bg-muted p-4 text-xs leading-6 overflow-x-auto">
            <code>{children}</code>
        </pre>
    );
}

const mcpUrl = `${siteConfig.url}/api/mcp`;

const tools: { name: string; description: string }[] = [
    { name: "create_event", description: "候補日程を指定して、新しい日程調整イベントを作成する" },
    { name: "list_my_events", description: "自分がこれまでに作成したイベントの一覧を取得する" },
    { name: "get_event", description: "イベントの内容や、参加者の回答状況を確認する" },
    { name: "participate_in_event", description: "イベントに出欠を登録したり、既に送った回答を修正したりする" },
    { name: "admin_confirm_candidate", description: "（管理者操作）候補日程の中から開催日を確定する" },
    { name: "admin_duplicate_event", description: "（管理者操作）既存のイベントを複製して新しいイベントを作る" },
    { name: "admin_export_csv", description: "（管理者操作）参加者の回答結果をCSV形式で取り出す" },
    { name: "admin_update_results_visibility", description: "（管理者操作）回答結果を参加者全員に公開するかどうかを設定する" },
];

export default function McpSupportPage() {
    return (
        <main className="min-h-screen bg-background text-foreground p-6 md:p-10">
            <div className="mx-auto max-w-3xl space-y-8">
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold">AIエージェント連携（MCP）</h1>
                    <p className="text-sm leading-7 text-muted-foreground">
                        {siteConfig.name}は、Claudeなどの対応するAIエージェントから直接イベントを作成・確認・操作できる、MCP
                        (Model Context Protocol) サーバーを備えています。エージェントに接続を追加すると、「来週の候補日を作って」
                        「◯◯さんの回答状況を教えて」といった会話だけで、{siteConfig.name}を操作できるようになります。
                    </p>
                </div>

                <section className="space-y-3">
                    <h2 className="text-xl font-semibold">できること</h2>
                    <p className="text-sm leading-7 text-muted-foreground">
                        接続すると、AIエージェントから次の操作ができるようになります。「管理者操作」は、イベント作成時に設定した
                        管理者パスワードを伝えたときだけ実行できます。
                    </p>
                    <ul className="space-y-2 text-sm leading-7 text-muted-foreground list-none">
                        {tools.map((tool) => (
                            <li key={tool.name} className="rounded-md border p-3">
                                <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted">{tool.name}</code>
                                <span className="ml-2">{tool.description}</span>
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="space-y-3">
                    <h2 className="text-xl font-semibold">Claude Codeで追加する</h2>
                    <p className="text-sm leading-7 text-muted-foreground">
                        ターミナルで次のコマンドを実行すると、Claude Codeにこのサーバーが登録されます。
                    </p>
                    <CodeBlock>{`claude mcp add --transport http chousei-kun ${mcpUrl}`}</CodeBlock>
                    <p className="text-sm leading-7 text-muted-foreground">
                        登録後は <code className="text-xs font-mono px-1 py-0.5 rounded bg-muted">claude mcp list</code>{" "}
                        で接続状態を確認できます。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-xl font-semibold">Claude Desktopなど他のMCPクライアントで追加する</h2>
                    <p className="text-sm leading-7 text-muted-foreground">
                        設定ファイルからリモートMCPサーバーを追加できるクライアントでは、サーバー名は任意のもの（例:
                        chousei-kun）、通信方式は HTTP、接続先には次のURLを指定してください。追加のログインやAPIキーは不要です。
                    </p>
                    <CodeBlock>{mcpUrl}</CodeBlock>
                </section>

                <section className="space-y-3">
                    <h2 className="text-xl font-semibold">セキュリティについて</h2>
                    <p className="text-sm leading-7 text-muted-foreground">
                        MCP経由の操作は、{siteConfig.name}本体と同じ仕組みで行われます。専用のアカウントやログインは無く、
                        誰でもこのURLに接続してイベントを作成したり回答したりできます。管理者操作（開催日の確定・複製・
                        CSV出力・公開設定の変更）だけは、そのイベント作成時に設定した管理者パスワードを伝えたときに限って
                        実行されます。管理者パスワードは、Webの管理画面にログインするときと同じように、信頼できる相手・
                        エージェントにしか伝えないようにしてください。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-xl font-semibold">配布用Skillについて</h2>
                    <p className="text-sm leading-7 text-muted-foreground">
                        リポジトリの <code className="text-xs font-mono px-1 py-0.5 rounded bg-muted">skills/chousei-kun/</code>{" "}
                        には、上記のツールの使い方（候補日程の入力形式や管理者パスワードの扱い方など）をAIエージェントに
                        あらかじめ伝えておくためのSkillファイルが同梱されています。お使いの環境の
                        Skillsフォルダ（Claude Codeであれば <code className="text-xs font-mono px-1 py-0.5 rounded bg-muted">~/.claude/skills/</code>）
                        にこのフォルダをコピーしておくと、より的確にツールを使ってもらえるようになります。
                    </p>
                </section>

                <div className="pt-4">
                    <Link href="/" className="text-sm underline underline-offset-4">
                        トップへ戻る
                    </Link>
                </div>
            </div>
        </main>
    );
}
