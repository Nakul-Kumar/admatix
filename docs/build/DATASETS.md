# AdMatix — Dataset Acquisition Spec

Build-ready acquisition spec for the five public datasets used to (a) simulate
realistic AI-run paid-advertising campaigns and (b) validate the AdMatix causal
lift / incrementality engine against known ground truth. Verified current as of
**2026-05-23**. All shell commands target a Linux VPS; Kaggle datasets assume the
`kaggle` CLI is installed and `~/.kaggle/kaggle.json` (token) is present, which
the target VPS already has.

---

## 1. Criteo Uplift Prediction Dataset (v2.1 — corrected ~14M-row release)

- **Download URL:** `http://go.criteo.net/criteo-research-uplift-v2.1.csv.gz`
  (permanent redirect from the AI Lab dataset page).
- **Size:** ~297 MB compressed (`.csv.gz`); ~1.4–1.5 GB uncompressed CSV.
- **Format:** single gzip-compressed CSV, comma-separated, header row present.
- **Rows:** 13,979,592. Avg visit rate .046992, avg conversion rate .00292, treatment ratio .85.
- **Schema (16 columns, all numeric):**
  | Column | Type | Meaning |
  |---|---|---|
  | `f0`–`f11` | float | 12 dense anonymized, randomly-projected feature values |
  | `treatment` | int (0/1) | 1 = user in treated group, 0 = control |
  | `conversion` | int (0/1) | label — conversion occurred for this user |
  | `visit` | int (0/1) | label — site visit occurred for this user |
  | `exposure` | int (0/1) | user was effectively exposed to advertising |
- **License:** Creative Commons **BY-NC-SA 4.0** — **NON-COMMERCIAL only**, ShareAlike, attribution required. Cite Diemert et al., AdKDD 2018.
- **Treatment/control labels:** YES — explicit `treatment` flag plus `conversion`/`visit` outcome labels. This is the canonical randomized-trial uplift benchmark.
- **Checksum:** none published by Criteo. Capture `sha256sum` on first download and pin it in the repo (`data/checksums/criteo_uplift_v2.1.sha256`).
- **Commands:**
  ```bash
  mkdir -p data/raw/criteo_uplift && cd data/raw/criteo_uplift
  curl -L -o criteo-uplift-v2.1.csv.gz http://go.criteo.net/criteo-research-uplift-v2.1.csv.gz
  sha256sum criteo-uplift-v2.1.csv.gz | tee criteo_uplift_v2.1.sha256   # pin this value
  gunzip -k criteo-uplift-v2.1.csv.gz                                    # -k keeps the .gz
  head -1 criteo-uplift-v2.1.csv && wc -l criteo-uplift-v2.1.csv         # expect 13,979,593 lines incl. header
  ```

---

## 2. Criteo Attribution Modeling for Bidding Dataset

- **Download URL:** `http://go.criteo.net/criteo-research-attribution-dataset.zip`
- **Size:** ~623 MB zip; the inner `criteo_attribution_dataset.tsv.gz` is ~623 MB compressed and ~2.4 GB uncompressed.
- **Format:** ZIP containing `criteo_attribution_dataset.tsv.gz` (gzipped TSV, tab-separated, header present), plus `README.md` and `Experiments.ipynb`.
- **Rows:** 16.5M impressions, 45K conversions, 700 campaigns, 30 days of live traffic. One row = one impression.
- **Schema (tab-separated):**
  | Column | Type | Meaning |
  |---|---|---|
  | `timestamp` | int | seconds from first impression; file sorted by this |
  | `uid` | int/hash | unique user identifier |
  | `campaign` | int/hash | unique campaign identifier |
  | `conversion` | int (0/1) | conversion within 30 days after impression |
  | `conversion_timestamp` | int | timestamp of conversion, -1 if none |
  | `conversion_id` | int | unique conversion id (rebuilds timelines), -1 if none |
  | `attribution` | int (0/1) | conversion attributed to Criteo |
  | `click` | int (0/1) | impression was clicked |
  | `click_pos` | int | click position before conversion (0 = first click) |
  | `click_nb` | int | number of clicks before a conversion |
  | `cost` | float | transformed price Criteo paid for the display |
  | `cpo` | float | transformed cost-per-order for attributed conversion |
  | `time_since_last_click` | float | seconds since last click for this impression |
  | `cat1`–`cat9` | categorical | 9 anonymized contextual features (hashing-trick ready) |
- **License:** Creative Commons **BY-NC-SA 4.0** — **NON-COMMERCIAL only**, ShareAlike, attribution required. Cite Diemert, Meynet et al., AdKDD 2017.
- **Treatment/control labels:** NO explicit treatment/control split — this is observational attribution data, not a randomized trial. It carries `conversion`, `attribution`, `click`, `cost`, and `cpo`, which makes it ideal for **campaign realism** (timing, cost, multi-touch paths) but not for ground-truth lift validation.
- **Checksum:** none published. Compute and pin `sha256sum` on first download.
- **Commands:**
  ```bash
  mkdir -p data/raw/criteo_attribution && cd data/raw/criteo_attribution
  curl -L -o criteo-attribution.zip http://go.criteo.net/criteo-research-attribution-dataset.zip
  sha256sum criteo-attribution.zip | tee criteo_attribution.sha256       # pin this value
  unzip criteo-attribution.zip
  gunzip -k criteo_attribution_dataset.tsv.gz
  head -1 criteo_attribution_dataset.tsv && wc -l criteo_attribution_dataset.tsv
  ```

---

## 3. Hillstrom / MineThatData E-Mail Analytics Challenge (Uplift)

- **Download URL:** `https://blog.minethatdata.com/2008/03/minethatdata-e-mail-analytics-and-data.html`
  links to the raw CSV: `http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv`
  Mirror (no auth): Kaggle `bofulee/kevin-hillstrom-minethatdata-e-mailanalytics`.
- **Size:** ~5 MB uncompressed CSV (~433 KB if gzipped). 64,000 rows.
- **Format:** plain CSV, comma-separated, header row present.
- **Schema (12 columns):**
  | Column | Type | Meaning |
  |---|---|---|
  | `recency` | int | months since last purchase |
  | `history_segment` | categorical | bucketed dollars spent in past year |
  | `history` | float | actual dollars spent in past year |
  | `mens` | int (0/1) | bought Mens merchandise in past year |
  | `womens` | int (0/1) | bought Womens merchandise in past year |
  | `zip_code` | categorical | Urban / Suburban / Rural |
  | `newbie` | int (0/1) | new customer in past 12 months |
  | `channel` | categorical | purchase channel(s) in past year |
  | `segment` | categorical | **treatment** — `Mens E-Mail` / `Womens E-Mail` / `No E-Mail` |
  | `visit` | int (0/1) | label — visited site in following 2 weeks |
  | `conversion` | int (0/1) | label — purchased in following 2 weeks |
  | `spend` | float | label — actual dollars spent in following 2 weeks |
- **License:** No formal license file. Kevin Hillstrom released it publicly "for the world" for the open challenge; treated as **public-domain / free use** by the uplift-modeling community (used by scikit-uplift, causeinfer). For commercial product use, a courtesy email + attribution to Kevin Hillstrom / MineThatData is recommended.
- **Treatment/control labels:** YES — randomized 3-arm trial (`segment`); `No E-Mail` is the control. Outcome labels `visit`, `conversion`, `spend`. A clean, small ground-truth uplift dataset.
- **Checksum:** none published. Compute and pin `sha256sum`.
- **Commands:**
  ```bash
  mkdir -p data/raw/hillstrom && cd data/raw/hillstrom
  curl -L -o hillstrom.csv \
    http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv
  sha256sum hillstrom.csv | tee hillstrom.sha256          # pin this value
  head -1 hillstrom.csv && wc -l hillstrom.csv             # expect 64,001 lines incl. header
  # Fallback if minethatdata.com is unreachable:
  # kaggle datasets download -d bofulee/kevin-hillstrom-minethatdata-e-mailanalytics -p . --unzip
  ```

---

## 4. Avazu Click-Through Rate Prediction (Kaggle)

- **Download URL:** Kaggle competition `avazu-ctr-prediction`.
  Page: `https://www.kaggle.com/c/avazu-ctr-prediction/data`. CLI slug: `avazu-ctr-prediction`.
- **Size:** competition archive ~1.2 GB compressed; `train.gz` ~1.1 GB compressed (~6 GB uncompressed), `test.gz` ~700 MB. ~40.4M training rows.
- **Format:** competition download is a ZIP; inside are gzipped CSVs (`train.gz`, `test.gz`) plus `sampleSubmission.gz`. Comma-separated, header present.
- **Schema (24 columns; `train` has `click`, `test` omits it):**
  | Column | Type | Meaning |
  |---|---|---|
  | `id` | string | ad impression identifier |
  | `click` | int (0/1) | **label** — 1 = clicked (train only) |
  | `hour` | int | timestamp, format `YYMMDDHH` |
  | `C1` | categorical | anonymized categorical variable |
  | `banner_pos` | categorical | banner position on page |
  | `site_id` / `site_domain` / `site_category` | categorical | hashed publisher site identifiers |
  | `app_id` / `app_domain` / `app_category` | categorical | hashed app identifiers |
  | `device_id` / `device_ip` / `device_model` | categorical | hashed device identifiers |
  | `device_type` | categorical | device type code |
  | `device_conn_type` | categorical | connection type code |
  | `C14`–`C21` | categorical | 8 anonymized categorical variables |
- **License:** Kaggle competition data — governed by the **competition rules / Kaggle TOS**. No open redistribution license; permitted for research/modeling. Not safe to redistribute the raw files; commercial internal use is generally accepted but the raw data must not be re-published.
- **Treatment/control labels:** NO treatment/control and NO conversion label — `click` only. This is **campaign-realism / CTR-modeling** material, not lift-validation ground truth.
- **Checksum:** Kaggle serves an archive with internal integrity checks; no separately published checksum. Compute and pin `sha256sum` of the downloaded archive.
- **Commands (requires accepting competition rules once on the Kaggle site):**
  ```bash
  mkdir -p data/raw/avazu && cd data/raw/avazu
  kaggle competitions download -c avazu-ctr-prediction -p .
  sha256sum avazu-ctr-prediction.zip | tee avazu.sha256   # pin this value
  unzip avazu-ctr-prediction.zip
  gunzip -k train.gz test.gz
  head -1 train && wc -l train
  ```

---

## 5. iPinYou RTB Dataset

- **Download URL:** raw archive `ipinyou.contest.dataset.zip` from the UCL mirror:
  `http://bunwell.cs.ucl.ac.uk/ipinyou.contest.dataset.zip`.
  Formalisation tooling: `https://github.com/wnzhang/make-ipinyou-data`.
  Official contest page (reference): `http://contest.ipinyou.com/`.
- **Size:** raw zip ~10 GB compressed; ~35 GB raw uncompressed; formalised output is ~14 GB after running `make all`.
- **Format:** ZIP of per-season folders (`training1st/2nd/3rd`, `testing1st/2nd/3rd`) holding bzip2-compressed tab-separated bid/impression/click/conversion logs, plus `files.md5`, region/city lookup tables, and `user.profile.tags`.
- **Schema (bid/impression/click/conversion log columns, tab-separated):**
  `BidID`, `Timestamp`, `Logtype`, `iPinYouID` (user), `User-Agent`, `IP`,
  `Region`, `City`, `AdExchange`, `Domain`, `URL`, `AnonymousURLID`,
  `AdSlotID`, `AdSlotWidth`, `AdSlotHeight`, `AdSlotVisibility`,
  `AdSlotFormat`, `AdSlotFloorPrice`, `CreativeID`, `BiddingPrice`,
  `PayingPrice`, `KeyPageURL`, `AdvertiserID`, `UserTags`.
  All categorical/string except numeric `Timestamp`, width/height, floor/bidding/paying prices. `PayingPrice` (winning price) and the click/conversion log flags are the modeling targets.
- **License:** The `make-ipinyou-data` formalisation repo is **Apache-2.0**. The underlying raw iPinYou data is released for the academic RTB benchmarking competition (research use); iPinYou publishes no explicit open commercial license. Treat raw data as **research-use, non-redistributable**; commercial use is not clearly granted.
- **Treatment/control labels:** NO randomized treatment/control. Carries click and conversion logs plus auction win/loss and prices — strong for **bidding/RTB campaign realism**, not lift-validation ground truth.
- **Checksum:** YES — the raw archive ships `files.md5` covering all member files. Verify against it.
- **Commands:**
  ```bash
  mkdir -p data/raw/ipinyou && cd data/raw/ipinyou
  curl -L -o ipinyou.contest.dataset.zip http://bunwell.cs.ucl.ac.uk/ipinyou.contest.dataset.zip
  sha256sum ipinyou.contest.dataset.zip | tee ipinyou_archive.sha256   # pin this value
  unzip ipinyou.contest.dataset.zip
  cd ipinyou.contest.dataset && md5sum -c files.md5                    # publisher-provided checksum
  # Optional: standardise into per-campaign train/test format
  cd .. && git clone https://github.com/wnzhang/make-ipinyou-data.git
  # then follow its README (symlink original-data, run `make all`)
  ```

---

## Essential vs. Optional Ranking

**ESSENTIAL — treatment/control ground truth for validating the verification engine:**

1. **Criteo Uplift Prediction v2.1** — the primary validation asset. Large-scale,
   explicit randomized `treatment` flag with `conversion`/`visit` outcomes. The
   AdMatix lift engine's estimates must be checked against the known incremental
   effect this dataset encodes.
2. **Hillstrom / MineThatData** — the secondary validation asset and the best
   first-integration target: tiny (5 MB), clean 3-arm randomized trial with an
   explicit `No E-Mail` control. Fast to iterate; ideal for unit-level and CI
   regression tests of the causal engine.

**NICE-TO-HAVE — campaign realism, not lift validation:**

3. **Criteo Attribution Modeling for Bidding** — realistic multi-touch
   conversion paths, costs, and attribution flags for simulating believable
   campaign economics; no randomized control.
4. **Avazu CTR** — large-scale realistic impression/click distributions for
   CTR-model and traffic simulation; click-only, no conversion or control.
5. **iPinYou RTB** — auction-level bid/win/price dynamics for realistic RTB
   campaign simulation; large, research-licensed, no randomized control.

**Safe permissively-licensed default:** **Hillstrom / MineThatData.** It is the
only dataset here without a NonCommercial (`BY-NC-SA`) restriction or
competition-TOS / research-only constraint — it has been treated as effectively
public-domain by the uplift-modeling ecosystem for over 15 years. Use it as the
default dataset in any public demo, open-source example, CI fixture, or
commercially-distributed artifact. The two Criteo datasets are **BY-NC-SA 4.0
NonCommercial** and must be confined to internal R&D and non-commercial
validation; Avazu is bound by Kaggle competition TOS; iPinYou is research-use
only. Treat all four of those as internal-only and do not redistribute the raw
files in the AdMatix repo or product.

---

## Sources

- Criteo Uplift Prediction Dataset — https://ailab.criteo.com/criteo-uplift-prediction-dataset/
- Criteo Uplift v2.1 download — http://go.criteo.net/criteo-research-uplift-v2.1.csv.gz
- Criteo Attribution Modeling for Bidding Dataset — https://ailab.criteo.com/criteo-attribution-modeling-bidding-dataset/
- Criteo Attribution download — http://go.criteo.net/criteo-research-attribution-dataset.zip
- Hillstrom MineThatData challenge — https://blog.minethatdata.com/2008/03/minethatdata-e-mail-analytics-and-data.html
- Hillstrom CSV — http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv
- scikit-uplift fetch_hillstrom (schema reference) — https://www.uplift-modeling.com/en/latest/api/datasets/fetch_hillstrom.html
- Hillstrom Kaggle mirror — https://www.kaggle.com/datasets/bofulee/kevin-hillstrom-minethatdata-e-mailanalytics
- Avazu CTR Prediction (Kaggle competition) — https://www.kaggle.com/c/avazu-ctr-prediction
- iPinYou contest site — http://contest.ipinyou.com/
- iPinYou raw data (UCL mirror) — http://bunwell.cs.ucl.ac.uk/ipinyou.contest.dataset.zip
- make-ipinyou-data formalisation repo — https://github.com/wnzhang/make-ipinyou-data
