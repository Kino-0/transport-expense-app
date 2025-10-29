-- --------------------------------------------------
-- Supabase (PostgreSQL) 向け publicスキーマ定義
-- --------------------------------------------------

-- 1. 部署マスター
CREATE TABLE dept_mst
(
    dept_code   CHAR(3) NOT NULL PRIMARY KEY,
    dept_name   VARCHAR(20)
);

-- 2. 従業員マスター
CREATE TABLE emp_mst
(
    emp_code    CHAR(7) NOT NULL PRIMARY KEY,
    dept_code   CHAR(3),
    emp_name    VARCHAR(20),
    emp_mail    VARCHAR(50),
    FOREIGN KEY (dept_code)
        REFERENCES dept_mst(dept_code)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 3. ステータスマスター
CREATE TABLE stat_mst
(
    status_id   INT NOT NULL PRIMARY KEY,
    status_name VARCHAR(50)
);

-- 4. 申請ヘッダー
CREATE TABLE trn_hdr
(
    appl_id     UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    emp_code    CHAR(7),
    appl_date   DATE,
    status_id   INT,
    FOREIGN KEY (status_id)
        REFERENCES stat_mst(status_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (emp_code)
        REFERENCES emp_mst(emp_code)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- 5. 申請明細
CREATE TABLE trn_dtl
(
    detail_id       UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    appl_id         UUID NOT NULL,
    use_date        DATE NOT NULL,
    purpose         VARCHAR(50),
    line_name       VARCHAR(50),
    dep_station     VARCHAR(50),
    arr_station     VARCHAR(50),
    unit_price      INT NOT NULL,
    is_round_trip   BOOLEAN NOT NULL,
    FOREIGN KEY (appl_id)
        REFERENCES trn_hdr(appl_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);


-- --------------------------------------------------
-- サンプルデータの挿入
-- --------------------------------------------------

-- ステータスマスター
INSERT INTO stat_mst (status_id, status_name) VALUES
(1, '申請中'),
(2, '修正依頼'),
(3, '承認済'),
(4, '領収済'),
(9, '削除');

-- 部署マスター
INSERT INTO dept_mst (dept_code, dept_name) VALUES
('001', '営業部'),
('002', '開発部'),
('003', '総務部');

-- 従業員マスター
INSERT INTO emp_mst (dept_code, emp_code, emp_name, emp_mail) VALUES
('001', 'ABC1000', '山田 太郎', 'taro.yamada@example.com'),
('001', '0', '鈴木 花子', 'hanako.suzuki@example.com'),
('002', 'あいうえおかき', '佐藤 健', 'takeshi.sato@example.com'),
('003', 'empCode', '田中 明美', 'akemi.tanaka@example.com');


-- --------------------------------------------------
-- RLS (Row Level Security) の設定
-- --------------------------------------------------
-- ※ SupabaseのダッシュボードでRLSを有効にする必要があります。
-- ※ これは簡易的な設定です。本番環境ではより厳密なポリシーが必要です。

-- RLSを有効化
ALTER TABLE dept_mst ENABLE ROW LEVEL SECURITY;
ALTER TABLE emp_mst ENABLE ROW LEVEL SECURITY;
ALTER TABLE stat_mst ENABLE ROW LEVEL SECURITY;
ALTER TABLE trn_hdr ENABLE ROW LEVEL SECURITY;
ALTER TABLE trn_dtl ENABLE ROW LEVEL SECURITY;

-- --- ポリシーの作成 ---

-- 1. dept_mst (部署マスター)
-- 誰でも部署情報を読み取れる
CREATE POLICY "Public read access for dept_mst"
ON dept_mst FOR SELECT
USING (true);

-- 2. stat_mst (ステータスマスター)
-- 誰でもステータス情報を読み取れる
CREATE POLICY "Public read access for stat_mst"
ON stat_mst FOR SELECT
USING (true);

-- 3. emp_mst (従業員マスター)
-- ログイン（従業員コード検索）のために、匿名ユーザー(anon)に従業員コードと名前の読み取りを許可する
-- ※ 本来はEmail/Pass認証やカスタム認証(Edge Function)を使い、匿名にSELECTを許可すべきではない
CREATE POLICY "Allow anon users to search for employees"
ON emp_mst FOR SELECT
TO anon
USING (true);

-- 4. trn_hdr (申請ヘッダー)
-- 誰でも申請ヘッダーに挿入できる(デモ用)
CREATE POLICY "Allow anon to insert applications (DEMO ONLY)"
ON trn_hdr FOR INSERT
TO anon
WITH CHECK (true);

-- 誰でも申請ヘッダーを読み取れる(デモ用)
CREATE POLICY "Allow anon to select applications (DEMO ONLY)"
ON trn_hdr FOR SELECT
TO anon
USING (true);

-- 5. trn_dtl (申請明細)
-- 誰でも申請明細に挿入できる(デモ用)
CREATE POLICY "Allow anon to insert details (DEMO ONLY)"
ON trn_dtl FOR INSERT
TO anon
WITH CHECK (true);

-- 誰でも申請明細を読み取れる(デモ用)
CREATE POLICY "Allow anon to select details (DEMO ONLY)"
ON trn_dtl FOR SELECT
TO anon
USING (true);

-- --------------------------------------------------
-- RPC (Remote Procedure Call) の設定
-- --------------------------------------------------
-- 1. 従業員情報取得
CREATE OR REPLACE FUNCTION get_user_details(p_emp_code CHAR(7))
RETURNS TABLE (
    emp_code CHAR(7),
    emp_name VARCHAR(20),
    dept_name VARCHAR(20)
)
LANGUAGE sql
AS $$
    SELECT
        e.emp_code,
        e.emp_name,
        d.dept_name
    FROM
        emp_mst e
    LEFT JOIN
        dept_mst d ON e.dept_code = d.dept_code
    WHERE
        e.emp_code = p_emp_code;
$$;


-- 2. 申請履歴の取得
CREATE OR REPLACE FUNCTION get_expense_history(
    p_emp_code CHAR(7)
)
RETURNS TABLE (
    id UUID,
    date DATE,
    total INT,
    status VARCHAR(50),
    status_id INT
)
LANGUAGE sql
AS $$
    SELECT
        h.appl_id AS id,
        h.appl_date AS date,
        COALESCE(SUM(
            CASE
                WHEN d.is_round_trip THEN d.unit_price * 2
                ELSE d.unit_price
            END
        ), 0)::INT AS total,
        s.status_name AS status,
        h.status_id
    FROM
        trn_hdr h
    LEFT JOIN
        stat_mst s ON h.status_id = s.status_id
    LEFT JOIN
        trn_dtl d ON h.appl_id = d.appl_id
    WHERE
        h.emp_code = p_emp_code
    GROUP BY
        h.appl_id,
        h.appl_date,
        s.status_name,
        h.status_id
    ORDER BY
        h.appl_date DESC;
$$;


-- 3. 新規申請（ヘッダーと明細のトランザクション処理）
CREATE OR REPLACE FUNCTION submit_expense_application(
    p_emp_code CHAR(7),
    p_details JSONB
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    new_appl_id UUID;
    STATUS_PENDING CONSTANT INT := 1;
BEGIN
    INSERT INTO trn_hdr (emp_code, appl_date, status_id)
    VALUES (p_emp_code, CURRENT_DATE, STATUS_PENDING)
    RETURNING appl_id INTO new_appl_id;

    INSERT INTO trn_dtl (
        appl_id,
        use_date,
        purpose,
        line_name,
        dep_station,
        arr_station,
        unit_price,
        is_round_trip
    )
    SELECT
        new_appl_id,
        (detail_row->>'use_date')::DATE,
        detail_row->>'purpose',
        detail_row->>'line_name',
        detail_row->>'dep_station',
        detail_row->>'arr_station',
        (detail_row->>'unit_price')::INT,
        (detail_row->>'is_round_trip')::BOOLEAN
    FROM jsonb_array_elements(p_details) AS detail_row;

    RETURN new_appl_id;
END;
$$;



-- 4. 申請詳細の取得
CREATE OR REPLACE FUNCTION get_expense_details(p_appl_id UUID)
RETURNS TABLE (
    appl_id UUID,
    appl_date DATE,
    status_name VARCHAR(50),
    status_id INT,
    emp_name VARCHAR(20),
    dept_name VARCHAR(20),
    total_amount INT,
    details JSONB
)
LANGUAGE sql
AS $$
WITH DetailData AS (
    SELECT
        d.appl_id,
        jsonb_agg(jsonb_build_object(
            'use_date', d.use_date,
            'purpose', d.purpose,
            'line_name', d.line_name,
            'dep_station', d.dep_station,
            'arr_station', d.arr_station,
            'unit_price', d.unit_price,
            'is_round_trip', d.is_round_trip,
            'line_total', (CASE WHEN d.is_round_trip THEN d.unit_price * 2 ELSE d.unit_price END)
        ) ORDER BY d.use_date) AS details,
        SUM(
            CASE
                WHEN d.is_round_trip THEN d.unit_price * 2
                ELSE d.unit_price
            END
        )::INT AS total
    FROM
        trn_dtl d
    WHERE
        d.appl_id = p_appl_id
    GROUP BY
        d.appl_id
)
SELECT
    h.appl_id,
    h.appl_date,
    s.status_name,
    h.status_id,
    e.emp_name,
    d_mst.dept_name,
    COALESCE(dd.total, 0) AS total_amount,
    dd.details
FROM
    trn_hdr h
LEFT JOIN
    emp_mst e ON h.emp_code = e.emp_code
LEFT JOIN
    dept_mst d_mst ON e.dept_code = d_mst.dept_code
LEFT JOIN
    stat_mst s ON h.status_id = s.status_id
LEFT JOIN
    DetailData dd ON h.appl_id = dd.appl_id
WHERE
    h.appl_id = p_appl_id;
$$;