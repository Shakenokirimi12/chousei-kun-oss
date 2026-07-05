-- Migration number: 0013_availabilities_natural_key.sql
-- availabilities を自然キー (participant_id, candidate_idx) の複合主キーへ正規化する。
--
-- 背景:
--   旧テーブルは surrogate UUID `id` を主キーに持ち、(participant_id, candidate_idx)
--   に UNIQUE 制約が無かった。このため同一 (参加者, 候補) に対する重複行を構造的に
--   許してしまい、UPSERT も使えず「全 DELETE → 全 INSERT」で回答を取り替えていた。
--
-- 変更:
--   - 主キーを (participant_id, candidate_idx) の複合主キーに変更（自然キーの一意性を保証）
--   - 冗長な surrogate id 列を撤去
--   - FK (participant_id -> participants.id) ON DELETE CASCADE は維持
--   - 旧 idx_availabilities_participant_id は複合主キー索引の先頭プレフィックスで
--     代替できるため不要（DROP TABLE で消滅）

CREATE TABLE availabilities_new (
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    candidate_idx INTEGER NOT NULL,
    status INTEGER NOT NULL, -- 0: X / 1: Triangle / 2: O
    PRIMARY KEY (participant_id, candidate_idx)
);

-- 旧データを移送。UNIQUE 制約が無かったため重複があり得るので、
-- 同一 (participant_id, candidate_idx) は 1 行に集約する。
INSERT INTO availabilities_new (participant_id, candidate_idx, status)
SELECT participant_id, candidate_idx, MAX(status)
FROM availabilities
GROUP BY participant_id, candidate_idx;

DROP TABLE availabilities;
ALTER TABLE availabilities_new RENAME TO availabilities;
