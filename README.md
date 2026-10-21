# 인천고잔고등학교 식물도감 — Supabase 전환본

기존 화면과 식물 5종 작성 방식을 유지하면서 서버를 Google Apps Script에서 Supabase로 교체한 완성 파일입니다.

## 포함된 기능

- 학생은 학번과 이름만 입력하고 처음 접속할 때 자동 등록
- 학생 비밀번호 입력 및 비밀번호 변경 화면 제거
- 식물 5종 작성, 이어쓰기, 제출 상태 확인
- 사진을 비공개 Supabase Storage에 저장
- 친구들의 식물도감과 열람 기록
- 교사 비밀번호 로그인 및 5회 실패 시 3분 차단
- 교사 대시보드에서 학생별 작성 완료 식물 수와 사진 확인
- 교사 대시보드에서 전체 작성 내용 CSV 다운로드(사진 제외)
- 교사 대시보드에서 학생 사용 중지·재개 및 완전 삭제
- 학생 삭제 시 작성 내용, 열람 기록, Storage 사진까지 함께 삭제
- 글을 사진보다 먼저 저장하고 실패 요청을 재시도하여 업로드 중 내용 유실 방지
- 브라우저 임시 저장을 통한 작성 중 내용 보호

## 중요한 보안 특성

학생 비밀번호를 사용하지 않으므로 **학번과 이름을 정확히 아는 사람은 그 학생의 기록에 접속할 수 있습니다.** 비밀번호 없는 로그인의 구조적인 특성입니다. 교사 비밀번호와 Supabase 관리자 키는 브라우저에 넣지 않고 Edge Function 안에서만 사용합니다.

`config.js`에는 반드시 `sb_publishable_...` 키만 넣으세요. `sb_secret_...` 또는 `service_role` 키를 넣으면 안 됩니다.

## 1. 데이터베이스 설치

1. Supabase 프로젝트에서 `SQL Editor`를 엽니다.
2. `New query`를 누릅니다.
3. `supabase/setup.sql`의 내용을 전부 붙여 넣습니다.
4. `Run`을 한 번 누릅니다.
5. 오류 없이 완료됐는지 확인합니다.

이 SQL은 앱 표, 보안 설정, 비공개 사진 버킷을 한 번에 만듭니다.

## 2. 교사 비밀번호 설정

1. Supabase 왼쪽 메뉴에서 `Edge Functions`를 엽니다.
2. `Secrets`를 엽니다.
3. 다음 Secret을 추가합니다.

| Key | Value |
|---|---|
| `TEACHER_PASSWORD` | 실제 사용할 교사 비밀번호 |

비밀번호는 GitHub 파일에 적지 않습니다.

## 3. Edge Function 배포

### Dashboard에서 배포

1. `Edge Functions` → `Deploy a new function` → `Via Editor`를 선택합니다.
2. 함수 이름을 정확히 `plant-guide-api`로 입력합니다.
3. `supabase/functions/plant-guide-api/index.ts`의 내용을 전부 붙여 넣습니다.
4. 함수의 JWT 검증 옵션은 **끄기(Verify JWT disabled)**로 설정합니다.
5. `Deploy function`을 누릅니다.

함수 자체가 Publishable key, 학생 세션, 교사 세션을 검증하므로 JWT 검증을 끄는 설정이 필요합니다.

### Supabase CLI로 배포하는 경우

프로젝트 폴더에서 다음을 실행합니다.

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set TEACHER_PASSWORD="실제교사비밀번호"
supabase functions deploy plant-guide-api --no-verify-jwt
```

`supabase/config.toml`에도 같은 설정이 포함되어 있습니다.

## 4. 웹앱 연결값 입력

1. Supabase 프로젝트 위쪽의 `Connect`를 누릅니다.
2. `Project URL`과 `Publishable key`를 확인합니다.
3. `config.js`를 열어 다음 두 값만 교체합니다.

```javascript
window.PLANT_GUIDE_CONFIG = {
  supabaseUrl: "https://프로젝트참조값.supabase.co",
  supabasePublishableKey: "sb_publishable_실제키"
};
```

## 5. 기존 사이트를 건드리지 않고 시험

현재 운영 중인 GitHub Pages 파일은 바로 교체하지 마세요.

1. 이 폴더를 별도 테스트 저장소 또는 별도 브랜치에 업로드합니다.
2. 테스트 주소에서 학생 계정 2개를 학번·이름으로 자동 등록합니다.
3. 학생별로 글 저장, 새로고침 후 다시 로그인, 이어쓰기, 사진 업로드를 확인합니다.
4. 교사 로그인 후 작성 완료 식물 수와 사진을 확인합니다.
5. CSV 파일을 내려받아 한글과 줄바꿈이 정상인지 확인합니다.
6. 테스트 학생 한 명을 삭제하고 표·사진이 함께 사라지는지 확인합니다.
7. 모든 검사가 끝난 뒤 현재 `plantbook` 저장소의 파일을 교체합니다.

## 6. GitHub Pages에 올릴 파일

다음 파일을 저장소 최상위에 올립니다.

- `index.html`
- `style.css`
- `script.js`
- `config.js`
- `manifest.json`
- `icon-192.png`
- `icon-512.png`
- `apple-touch-icon.png`

`supabase` 폴더는 GitHub에 함께 보관해도 되지만 웹앱 실행에는 필요하지 않습니다. Secret 값은 포함하지 마세요.

## 기존 자료와의 관계

- 기존 Google Sheets와 Google Drive 자료는 삭제되거나 초기화되지 않습니다.
- 새 Supabase 버전에서는 기존 자료를 읽지 않습니다.
- 최종 전환 후 Apps Script는 사용하지 않습니다.
- 전환 전까지 현재 운영 사이트는 기존 Apps Script를 계속 사용합니다.

## 장애 시 확인할 곳

- 학생·교사 모두 연결 실패: `config.js`의 URL과 Publishable key
- 교사 로그인만 실패: `TEACHER_PASSWORD` Secret
- 모든 API 요청 실패: Edge Function 이름과 `Verify JWT disabled` 설정
- 사진만 실패: `setup.sql` 실행 여부와 `plant-photos` 버킷 생성 여부
- 화면에서 사진이 안 보임: 브라우저 개발자 도구 Console 및 Edge Function Logs
