export const siteConfig = {
    name: "調整くん",
    description: "調整くんは、イベントの日程候補を作成し、参加者の出欠を集計して最適な日程を決めるためのスケジュール調整アプリです。",
    url: "https://schedule.soshosai.com",
    ui: {
        createEvent: {
            title: "新しい予定表を作成",
            description: "候補となる日程を選択してください。",
        },
        responseEvent: {
            titleNew: "出欠を入力",
            descriptionNew: "各日程の出欠を選択してください。",
            titleEdit: "回答を編集",
            descriptionEdit: "以下の出欠を更新してください。",
        },
        admin: {
            title: "管理画面",
        }
    }
};

export type SiteConfig = typeof siteConfig;
