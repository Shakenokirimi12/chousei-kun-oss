import Link from "next/link";
import { siteConfig } from "@/config/site";
import { Sparkles, Calendar, Zap, Layout, Bug, History } from "lucide-react";
import { budouxify } from "@/lib/budoux";

export const metadata = {
    title: `リリースノート - ${siteConfig.name}`,
    description: `${siteConfig.name}のこれまでのアップデート履歴をご確認いただけます。`,
};

const releases = [
    {
        version: "v1.2.0 (2026-05-17)",
        title: "AI日程調整アシスタント ＆ iCal連携の導入",
        type: "major",
        highlights: [
            { icon: Sparkles, text: "AI日程調整アシスタント (ベータ版): 自然言語で候補選択や出欠入力を自動化" },
            { icon: Calendar, text: "iCal (ICS) URLインポート: Googleカレンダーなどの外部カレンダーを直接同期" },
            { icon: Zap, text: "爆速AIレスポンス: GLM-5.1 / DeepSeek V4 Flashモデルによる高速な応答" },
            { icon: Layout, text: "UI/UX刷新: 右サイドペイン形式のAIチャット、時間ベースの正確なカレンダー描画" },
            { icon: Bug, text: "安定性向上: フック順序の最適化、JSONパースエラーの解消、Google認証フローの改善" }
        ]
    },
    {
        version: "v1.1.0 (2026-05-02)",
        title: "開発基盤とレスポンシブ対応の強化",
        type: "minor",
        highlights: [
            { icon: Layout, text: "レスポンシブレイアウトの改善: モバイル・タブレットでの操作性を大幅に向上" },
            { icon: Zap, text: "ESLint ＆ Drizzleプラグイン導入: コード品質とデータベース操作の型安全性を強化" },
            { icon: Calendar, text: "日付削除時のクリーンアップ: 選択済み期間の整合性を保つ自動削除機能" }
        ]
    },
    {
        version: "v1.0.5 (2026-04-28)",
        title: "ランディングページの刷新とGCal詳細説明",
        highlights: [
            { icon: Layout, text: "ランディングページのデザイン変更: 初めてのユーザーにも使いやすいガイドを追加" },
            { icon: Calendar, text: "Googleカレンダー連携の透明性向上: データの取り扱いに関する詳細セクションを追加" }
        ]
    },
    {
        version: "v1.0.0 (2026-04-27)",
        title: "正式リリース ＆ Google/大学予定連携",
        type: "major",
        highlights: [
            { icon: Calendar, text: "Googleカレンダー連携: 既存の予定を読み取って重複をチェック" },
            { icon: History, text: "大学予定 (Campus Square) 連携: 学生・教職員向けの自動スケジュール取得" },
            { icon: Zap, text: "下書き保存機能: 作成中のデータをローカルに保存し、誤って閉じても復元可能" },
            { icon: Layout, text: "ウィザード形式のイベント作成: 誰でも迷わずイベントを公開できるUI" }
        ]
    }
];

export default function ReleaseNotesPage() {
    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col">
            <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
                <nav className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
                    <Link href="/" className="text-xl font-bold flex items-center gap-2">
                        {siteConfig.name}
                        <span className="text-xs font-normal px-1.5 py-0.5 rounded bg-muted">Release Notes</span>
                    </Link>
                    <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                        ホームに戻る
                    </Link>
                </nav>
            </header>

            <main className="flex-1 max-w-4xl mx-auto px-4 py-12 w-full">
                <header className="mb-12">
                    <h1 className="text-3xl font-extrabold tracking-tight mb-4">リリースノート</h1>
                    <p className="text-muted-foreground">
                        {budouxify("調整くんの進化の軌跡。新機能の追加や改善、不具合修正の履歴をまとめています。")}
                    </p>
                </header>

                <div className="space-y-12">
                    {releases.map((release, i) => (
                        <section key={i} className="relative pl-8 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-px before:bg-border last:before:bottom-8">
                            <div className="absolute left-[-4px] top-2 w-2 h-2 rounded-full bg-primary ring-4 ring-background" />
                            
                            <div className="mb-2">
                                <span className={cn(
                                    "text-xs font-bold px-2 py-0.5 rounded-full mb-2 inline-block",
                                    release.type === "major" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                                )}>
                                    {release.version}
                                </span>
                                <h2 className="text-xl font-bold">{release.title}</h2>
                            </div>

                            <div className="grid gap-4 mt-6">
                                {release.highlights.map((item, j) => (
                                    <div key={j} className="flex gap-4 p-4 rounded-xl border bg-card/30 hover:bg-card/50 transition-colors group">
                                        <div className="shrink-0 w-10 h-10 rounded-full bg-background border flex items-center justify-center group-hover:border-primary/50 transition-colors">
                                            <item.icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-sm leading-relaxed">
                                                {budouxify(item.text)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            </main>

            <footer className="border-t bg-card/30 mt-20">
                <div className="max-w-4xl mx-auto px-4 py-8 text-center">
                    <p className="text-sm text-muted-foreground mb-4">
                        © 2026 {siteConfig.name}
                    </p>
                    <div className="flex justify-center gap-6 text-sm">
                        <Link href="/privacy" className="text-muted-foreground hover:text-foreground">プライバシーポリシー</Link>
                        <Link href="/tos" className="text-muted-foreground hover:text-foreground">利用規約</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}

function cn(...classes: (string | undefined | boolean)[]) {
    return classes.filter(Boolean).join(" ");
}
