// Supabase Edge Function 서버 주소
const SUPABASE_CONFIG = window.PLANT_GUIDE_CONFIG || {};
const SUPABASE_URL = String(SUPABASE_CONFIG.supabaseUrl || "").replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = String(
  SUPABASE_CONFIG.supabasePublishableKey || ""
);
const API_URL = `${SUPABASE_URL}/functions/v1/plant-guide-api`;

// 서버에서 발급받은 학생 로그인 토큰
let currentStudentToken = null;

// Supabase Edge Function 요청
async function callPlantGuideApi(
  action,
  requestData = {}
) {
  if (!validateSupabaseConfig()) {
    throw new Error("Supabase 연결 설정이 필요합니다.");
  }

  const response = await fetch(
    API_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "apikey": SUPABASE_PUBLISHABLE_KEY
      },

      body: JSON.stringify({
        action: action,
        ...requestData
      }),

      redirect: "follow"
    }
  );

  let result;

  try {
    result = await response.json();
  } catch (error) {
    throw new Error("서버 응답을 읽지 못했습니다.");
  }

  if (!response.ok) {
    throw new Error(
      result.message || "서버 응답을 받지 못했습니다."
    );
  }

  return result;
}

function validateSupabaseConfig() {
  const configured =
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) &&
    SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_");

  if (!configured) {
    window.alert(
      "Supabase 연결 설정이 필요합니다. config.js에 Project URL과 Publishable key를 입력해주세요."
    );
  }

  return configured;
}

// 서버가 일시적으로 혼잡할 때 저장 요청 자동 재시도
async function callPlantGuideApiWithRetry(
  action,
  requestData = {},
  maxAttempts = 4
) {
  let lastResult = null;
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
      const result =
        await callPlantGuideApi(
          action,
          requestData
        );

      if (
        result.success ||
        !result.retryable
      ) {
        return result;
      }

      lastResult = result;
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) {
      const delay =
        700 * Math.pow(2, attempt - 1) +
        Math.floor(Math.random() * 700);

      await new Promise(function (resolve) {
        window.setTimeout(resolve, delay);
      });
    }
  }

  if (lastResult) {
    return lastResult;
  }

  throw lastError || new Error(
    "서버 요청에 실패했습니다."
  );
}

// 화면
const welcomeSection =
  document.getElementById("welcomeSection");

const loginSection =
  document.getElementById("loginSection");

const studentMenuSection =
  document.getElementById("studentMenuSection");

const plantFormSection =
  document.getElementById("plantFormSection");

const plantFormBackButton =
  document.getElementById("plantFormBackButton");

const cancelPlantButton =
  document.getElementById("cancelPlantButton");

const plantRecordForm =
  document.getElementById("plantRecordForm");  

// 시작 및 로그인 버튼
const startButton =
  document.getElementById("startButton");

const backButton =
  document.getElementById("backButton");

const logoutButton =
  document.getElementById("logoutButton");

// 학생 메뉴 버튼
const writePlantButton =
  document.getElementById("writePlantButton");

const viewGuideButton =
  document.getElementById("viewGuideButton");

const myRecordsButton =
  document.getElementById("myRecordsButton");

// 로그인 폼
const loginForm =
  document.getElementById("loginForm");

const studentNumberInput =
  document.getElementById("studentNumber");

const studentNameInput =
  document.getElementById("studentName");

const loginMessage =
  document.getElementById("loginMessage");

// 학생 메뉴 표시
const loggedInStudentName =
  document.getElementById("loggedInStudentName");

const loggedInStudentNumber =
  document.getElementById("loggedInStudentNumber");

// 현재 로그인한 학생
let currentStudent = null;

const savedPhotoMap = new Map();

// 학생별 브라우저 임시저장 상태
let plantDraftSaveTimer = null;
let plantFormHasUnsavedChanges = false;

// 시작하기
startButton.addEventListener("click", function () {
  showOnlySection(loginSection);
  studentNumberInput.focus();
});

// 로그인 화면에서 돌아가기
backButton.addEventListener("click", function () {
  resetLogin();
  showOnlySection(welcomeSection);
});

// 학번과 이름으로 학생 자동 등록 및 로그인
loginForm.addEventListener(
  "submit",
  async function (event) {
    event.preventDefault();

    const studentNumber =
      studentNumberInput.value.trim();

    const studentName =
      studentNameInput.value.trim();

    if (
      !studentNumber ||
      !studentName
    ) {
      showMessage(
        loginMessage,
        "학번과 이름을 모두 입력해주세요.",
        "error"
      );

      return;
    }

    const loginButton =
      loginForm.querySelector(
        "button[type='submit']"
      );

    const originalButtonText =
      loginButton.textContent;

    loginButton.disabled = true;
    loginButton.textContent =
      "로그인 확인 중...";

    hideMessage(loginMessage);

    try {
      const result =
        await callPlantGuideApi(
          "studentLogin",
          {
            studentNumber:
              studentNumber,

            studentName:
              studentName
          }
        );

      if (!result.success) {
        showMessage(
          loginMessage,
          result.message ||
            "로그인할 수 없습니다.",
          "error"
        );

        return;
      }

      if (!result.sessionToken) {
        throw new Error(
          "로그인 토큰을 발급받지 못했습니다."
        );
      }
      
      currentStudent =
        result.student;

      currentStudentToken =
        result.sessionToken;

      resetLogin();

      await loadMySubmissionFromServer();
      openStudentMenu();
    } catch (error) {
      console.error(error);

      showMessage(
        loginMessage,
        error.message ||
          "서버에 연결하지 못했습니다. 인터넷 연결과 Supabase 설정을 확인해주세요.",
        "error"
      );
    } finally {
      loginButton.disabled = false;
      loginButton.textContent =
        originalButtonText;
    }
  }
);

// 로그아웃
logoutButton.addEventListener(
  "click",
  async function () {
    const shouldLogout =
      window.confirm(
        "로그아웃하시겠습니까?"
      );

    if (!shouldLogout) {
      return;
    }

    const tokenToDelete =
      currentStudentToken;

    // 로그아웃 직전까지 입력한 내용도 보존
    saveLocalPlantDraft();

    try {
      if (tokenToDelete) {
        await callPlantGuideApi(
          "studentLogout",
          {
            sessionToken:
              tokenToDelete
          }
        );
      }
    } catch (error) {
      console.error(
        "서버 로그아웃 처리 실패:",
        error
      );
    }

    currentStudent = null;
    currentStudentToken = null;
    savedPhotoMap.clear();
    sharedPlants = [];

    plantRecordForm.reset();
    plantFormHasUnsavedChanges = false;
    loginForm.reset();

    loggedInStudentName.textContent = "";
    loggedInStudentNumber.textContent = "";

    closePlantDetail();

    showOnlySection(welcomeSection);
    window.scrollTo(0, 0);
  }
);

// 학생 메뉴 열기
function openStudentMenu() {
  loggedInStudentName.textContent =
    currentStudent.studentName;

  loggedInStudentNumber.textContent =
    "학번 " + currentStudent.studentNumber;

  showOnlySection(studentMenuSection);
  window.scrollTo(0, 0);
}

// 메뉴 버튼 임시 안내
writePlantButton.addEventListener("click", function () {
  showOnlySection(plantFormSection);
  window.scrollTo(0, 0);
});

plantFormBackButton.addEventListener(
  "click",
  function () {
    showOnlySection(studentMenuSection);
    window.scrollTo(0, 0);
  }
);

cancelPlantButton.addEventListener(
  "click",
  function () {
    const hasWrittenContent =
      plantRecordForm.querySelector(
        "input:not([type='file']), textarea"
      ).value.trim() !== "";

    if (hasWrittenContent) {
      const shouldCancel = window.confirm(
        "작성 중인 내용이 사라집니다. 취소하시겠습니까?"
      );

      if (!shouldCancel) {
        return;
      }
    }

    plantRecordForm.reset();
    clearLocalPlantDraft();
    showOnlySection(studentMenuSection);
    window.scrollTo(0, 0);
  }
);

// 선택한 화면만 표시
function showOnlySection(sectionToShow) {
  const sections = [
    welcomeSection,
  loginSection,
  studentMenuSection,
  plantFormSection,
  teacherLoginSection,
  teacherDashboardSection,
  sharedGuideSection,
  myRecordsSection
  ];

  sections.forEach(function (section) {
    section.classList.add("hidden");
  });

  sectionToShow.classList.remove("hidden");
}

// 안내문 표시
function showMessage(element, message, type) {
  element.textContent = message;
  element.classList.add("show");

  if (type === "success") {
    element.style.color = "#176b38";
    element.style.backgroundColor = "#eef9f1";
    element.style.borderColor = "#add9b9";
  } else {
    element.style.color = "#b42318";
    element.style.backgroundColor = "#fff1f0";
    element.style.borderColor = "#ffc9c5";
  }
}

// 안내문 숨기기
function hideMessage(element) {
  element.textContent = "";
  element.classList.remove("show");
}

// 로그인 폼 초기화
function resetLogin() {
  loginForm.reset();
  hideMessage(loginMessage);
}

// 식물 5종 입력 화면
const speciesCount = 5;

let currentSpeciesIndex = 0;

const speciesTabs =
  document.getElementById("speciesTabs");

const speciesFormContainer =
  document.getElementById("speciesFormContainer");

const previousSpeciesButton =
  document.getElementById("previousSpeciesButton");

const nextSpeciesButton =
  document.getElementById("nextSpeciesButton");

const currentSpeciesText =
  document.getElementById("currentSpeciesText");

const speciesProgressText =
  document.getElementById("speciesProgressText");

const speciesProgressBar =
  document.getElementById("speciesProgressBar");

const plantFormMessage =
  document.getElementById("plantFormMessage");

  const finalRecordPanel =
  document.getElementById("finalRecordPanel");

const selectionReasonInput =
  document.getElementById("selectionReason");

const inquiryPlantInput =
  document.getElementById("inquiryPlant");

const inquiryTopicInput =
  document.getElementById("inquiryTopic");

const reflectionInput =
  document.getElementById("reflection");

const submitPlantButton =
  document.getElementById("submitPlantButton");

// 식물 1~5 입력란 생성
createSpeciesForms();
createFinalRecordTab();
showSpecies(0);
updateSpeciesProgress();

// 마무리 작성 탭 생성
function createFinalRecordTab() {
  const finalTab =
    document.createElement("button");

  finalTab.type = "button";
  finalTab.id = "finalRecordTab";
  finalTab.className =
    "species-tab final-record-tab";

  finalTab.innerHTML = `
    <span>마무리 작성</span>
    <small>작성 중</small>
  `;

  finalTab.addEventListener("click", function () {
    showSpecies(speciesCount);
  });

  speciesTabs.appendChild(finalTab);
}

function createSpeciesForms() {
  for (let index = 0; index < speciesCount; index += 1) {
    const speciesNumber = index + 1;

    const tabButton =
      document.createElement("button");

    tabButton.type = "button";
    tabButton.className = "species-tab";
    tabButton.dataset.speciesIndex = index;

    tabButton.innerHTML = `
      <span>식물 ${speciesNumber}</span>
      <small>작성 중</small>
    `;

    tabButton.addEventListener("click", function () {
      showSpecies(index);
    });

    speciesTabs.appendChild(tabButton);

    const speciesPanel =
      document.createElement("section");

    speciesPanel.className =
      "individual-species-form hidden";

    speciesPanel.dataset.speciesPanel = index;

    speciesPanel.innerHTML = `
      <div class="individual-species-heading">
        <span>${speciesNumber}</span>

        <div>
          <h3>식물 ${speciesNumber} 기록</h3>
          <p>
            ${speciesNumber}번째 식물의 정보와 사진을
            등록해주세요.
          </p>
        </div>
      </div>

      <fieldset class="form-section">
        <legend>1. 식물 이름</legend>

        <div class="two-column-form">
          <div class="form-group">
            <label for="species${speciesNumber}KoreanName">
              국명 <span class="required-mark">*</span>
            </label>

            <input
              id="species${speciesNumber}KoreanName"
              name="species${speciesNumber}KoreanName"
              type="text"
              maxlength="50"
              placeholder="예: 민들레"
              data-species-required="true"
            >
          </div>

          <div class="form-group">
            <label for="species${speciesNumber}ScientificName">
              학명 <span class="required-mark">*</span>
            </label>

            <input
              id="species${speciesNumber}ScientificName"
              name="species${speciesNumber}ScientificName"
              type="text"
              maxlength="100"
              placeholder="예: Taraxacum platycarpum"
              data-species-required="true"
            >
          </div>
        </div>
      </fieldset>

      <div class="two-column-form">
        <fieldset class="form-section">
          <legend>2. 발견 날짜</legend>

          <div class="form-group">
            <input
              id="species${speciesNumber}Date"
              name="species${speciesNumber}Date"
              type="date"
              data-species-required="true"
              aria-label="식물 ${speciesNumber} 발견 날짜"
            >
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>3. 발견 장소</legend>

          <div class="form-group">
            <input
              id="species${speciesNumber}Place"
              name="species${speciesNumber}Place"
              type="text"
              maxlength="100"
              placeholder="예: 본관 뒤 화단"
              data-species-required="true"
              aria-label="식물 ${speciesNumber} 발견 장소"
            >
          </div>
        </fieldset>
      </div>

      <fieldset class="form-section">
        <legend>4. 서식 환경</legend>

        <div class="form-group">
          <textarea
            id="species${speciesNumber}Habitat"
            name="species${speciesNumber}Habitat"
            rows="4"
            maxlength="500"
            placeholder="햇빛, 습도, 토양 및 주변 환경을 작성해주세요."
            data-species-required="true"
          ></textarea>
        </div>
      </fieldset>

      <fieldset class="form-section">
        <legend>5~7. 식물 사진</legend>

        <p class="photo-instruction">
          동일한 식물의 잎, 줄기, 전체 모습을
          각각 촬영해주세요.
        </p>

        <div class="photo-upload-grid">
          ${createPhotoUploadHtml(
            speciesNumber,
            "Leaf",
            "5. 잎의 사진",
            "잎 사진 미리보기"
          )}

          ${createPhotoUploadHtml(
            speciesNumber,
            "Stem",
            "6. 줄기의 사진",
            "줄기 사진 미리보기"
          )}

          ${createPhotoUploadHtml(
            speciesNumber,
            "Whole",
            "7. 식물 전체 사진",
            "전체 사진 미리보기"
          )}
        </div>
      </fieldset>

      <fieldset class="form-section">
        <legend>8. 식물 특징</legend>

        <div class="form-group">
          <textarea
            id="species${speciesNumber}Features"
            name="species${speciesNumber}Features"
            rows="6"
            maxlength="1500"
            placeholder="관찰한 식물의 형태와 특징을 구체적으로 작성해주세요."
            data-species-required="true"
          ></textarea>
        </div>
      </fieldset>

      <fieldset class="form-section">
        <legend>9. 참고자료 및 출처</legend>

        <div class="form-group">
          <textarea
            id="species${speciesNumber}References"
            name="species${speciesNumber}References"
            rows="4"
            maxlength="1000"
            placeholder="이 식물을 조사할 때 참고한 도서명, 웹사이트 주소 및 자료의 출처를 작성해주세요."
            data-species-required="true"
          ></textarea>
        </div>
      </fieldset>
    `;

    speciesFormContainer.appendChild(speciesPanel);

    connectSpeciesPhotoPreviews(speciesNumber);
  }

  plantRecordForm.addEventListener(
    "input",
    function () {
      updateSpeciesProgress();
      markPlantFormAsChanged();
    }
  );

  plantRecordForm.addEventListener(
    "change",
    function () {
      updateSpeciesProgress();
      markPlantFormAsChanged();
    }
  );
}

// 사진 업로드 HTML
function createPhotoUploadHtml(
  speciesNumber,
  photoType,
  labelText,
  previewText
) {
  return `
    <div class="photo-upload-box">
      <label for="species${speciesNumber}${photoType}Photo">
        ${labelText}
        <span class="required-mark">*</span>
      </label>

      <input
        id="species${speciesNumber}${photoType}Photo"
        name="species${speciesNumber}${photoType}Photo"
        type="file"
        accept="image/*"
        data-species-photo="true"
      >

      <div
        id="species${speciesNumber}${photoType}Preview"
        class="photo-preview"
        data-default-text="${previewText}"
      >
        ${previewText}
      </div>
    </div>
  `;
}

// 식물별 사진 미리보기 연결
function connectSpeciesPhotoPreviews(speciesNumber) {
  const photoTypes = ["Leaf", "Stem", "Whole"];

  photoTypes.forEach(function (photoType) {
    const input =
      document.getElementById(
        `species${speciesNumber}${photoType}Photo`
      );

    const preview =
      document.getElementById(
        `species${speciesNumber}${photoType}Preview`
      );

    let photoUrl = null;

    input.addEventListener("change", function () {
      const selectedFile = input.files[0];

      if (photoUrl) {
        URL.revokeObjectURL(photoUrl);
        photoUrl = null;
      }

      if (!selectedFile) {
        preview.textContent =
          preview.dataset.defaultText;
        return;
      }

      if (!selectedFile.type.startsWith("image/")) {
        window.alert("이미지 파일만 선택할 수 있습니다.");

        input.value = "";
        preview.textContent =
          preview.dataset.defaultText;
        return;
      }

      if (selectedFile.size > 10 * 1024 * 1024) {
        window.alert(
          "사진 한 장의 크기는 10MB 이하여야 합니다."
        );

        input.value = "";
        preview.textContent =
          preview.dataset.defaultText;
        return;
      }

      photoUrl =
        URL.createObjectURL(selectedFile);

      const image =
        document.createElement("img");

      image.src = photoUrl;
      image.alt = preview.dataset.defaultText;

      preview.replaceChildren(image);
    });

    plantRecordForm.addEventListener(
      "reset",
      function () {
        if (photoUrl) {
          URL.revokeObjectURL(photoUrl);
          photoUrl = null;
        }

        preview.textContent =
          preview.dataset.defaultText;
      }
    );
  });
}

// 선택한 식물 표시
function showSpecies(index) {
  currentSpeciesIndex = index;

  const panels =
    document.querySelectorAll(
      "[data-species-panel]"
    );

  const tabs =
    document.querySelectorAll(".species-tab");

  panels.forEach(function (panel, panelIndex) {
    panel.classList.toggle(
      "hidden",
      panelIndex !== index
    );
  });

  finalRecordPanel.classList.toggle(
    "hidden",
    index !== speciesCount
  );

  tabs.forEach(function (tab, tabIndex) {
    tab.classList.toggle(
      "active",
      tabIndex === index
    );
  });

  if (index === speciesCount) {
    currentSpeciesText.textContent =
      "마무리 작성 / 6";
  } else {
    currentSpeciesText.textContent =
      `식물 ${index + 1} / ${speciesCount}`;
  }

  previousSpeciesButton.disabled =
    index === 0;

  nextSpeciesButton.disabled =
    index === speciesCount;

  if (index === speciesCount) {
    nextSpeciesButton.textContent =
      "마지막 단계";
  } else {
    nextSpeciesButton.textContent =
      "다음 식물 →";
  }

  window.scrollTo({
    top: plantFormSection.offsetTop,
    behavior: "smooth"
  });
}

// 이전 식물
previousSpeciesButton.addEventListener(
  "click",
  function () {
    if (currentSpeciesIndex > 0) {
      showSpecies(currentSpeciesIndex - 1);
    }
  }
);

// 다음 식물
nextSpeciesButton.addEventListener(
  "click",
  function () {
    if (currentSpeciesIndex < speciesCount) {
  showSpecies(currentSpeciesIndex + 1);
}
  }
);

// 작성 완료 여부
function isSpeciesComplete(index) {
  const panel =
    document.querySelector(
      `[data-species-panel="${index}"]`
    );

  const textFields =
    panel.querySelectorAll(
      "[data-species-required]"
    );

  const photoFields =
    panel.querySelectorAll(
      "[data-species-photo]"
    );

  const allTextCompleted =
    Array.from(textFields).every(function (field) {
      return field.value.trim() !== "";
    });

  const allPhotosCompleted =
  Array.from(photoFields).every(
    function (field) {
      const photoTypes = [
        "Leaf",
        "Stem",
        "Whole"
      ];

      const photoType =
        photoTypes.find(
          function (type) {
            return field.id.includes(type);
          }
        );

      const savedPhotoExists =
        savedPhotoMap.has(
          getSavedPhotoKey(
            index + 1,
            photoType
          )
        );

      return (
        field.files.length > 0 ||
        savedPhotoExists
      );
    }
  );

  return allTextCompleted && allPhotosCompleted;
}

// 진행률 갱신
// 전체 작성 진행률 및 제출 버튼 상태 갱신
function updateSpeciesProgress() {
  // 마무리 탭을 제외한 식물 1~5 탭만 선택
  const plantTabs =
    document.querySelectorAll(
      ".species-tab[data-species-index]"
    );

  let completedSpeciesCount = 0;

  plantTabs.forEach(function (tab, index) {
    const completed =
      isSpeciesComplete(index);

    tab.classList.toggle(
      "completed",
      completed
    );

    const statusText =
      tab.querySelector("small");

    statusText.textContent =
      completed ? "완료 ✓" : "작성 중";

    if (completed) {
      completedSpeciesCount += 1;
    }
  });

  // 식물 5종 진행률 표시
  speciesProgressText.textContent =
    `${completedSpeciesCount} / ${speciesCount}종 완료`;

  speciesProgressBar.style.width =
    `${(completedSpeciesCount / speciesCount) * 100}%`;

  // 마무리 작성 4개 문항 작성 여부
  const selectionReasonCompleted =
    selectionReasonInput.value.trim() !== "";

  const inquiryPlantCompleted =
    inquiryPlantInput.value.trim() !== "";

  const inquiryTopicCompleted =
    inquiryTopicInput.value.trim() !== "";

  const reflectionCompleted =
    reflectionInput.value.trim() !== "";

  const finalRecordCompleted =
    selectionReasonCompleted &&
    inquiryPlantCompleted &&
    inquiryTopicCompleted &&
    reflectionCompleted;

  // 마무리 작성 탭 상태
  const finalRecordTab =
    document.getElementById("finalRecordTab");

  if (finalRecordTab) {
    finalRecordTab.classList.toggle(
      "completed",
      finalRecordCompleted
    );

    const finalStatusText =
      finalRecordTab.querySelector("small");

    finalStatusText.textContent =
      finalRecordCompleted
        ? "완료 ✓"
        : "작성 중";
  }

  // 모든 항목 완료 여부
  const allSpeciesCompleted =
    completedSpeciesCount === speciesCount;

  const everythingCompleted =
    allSpeciesCompleted &&
    finalRecordCompleted;

  // 모든 항목이 완료되어야 제출 버튼 활성화
  submitPlantButton.disabled = false;

  if (everythingCompleted) {
  submitPlantButton.textContent =
    "완성된 기록 제출하기";
} else {
  submitPlantButton.textContent =
    "현재 내용 제출하기";
}

submitPlantButton.title =
  "현재까지 작성한 내용을 제출합니다.";
}

// 현재 작성 내용을 Supabase에 저장
plantRecordForm.addEventListener(
  "submit",
  async function (event) {
    event.preventDefault();

    if (
      !currentStudent ||
      !currentStudentToken
    ) {
      window.alert(
        "로그인 정보가 만료되었습니다. 다시 로그인해주세요."
      );

      showOnlySection(loginSection);
      return;
    }

    const plants = [];

    for (
      let speciesNumber = 1;
      speciesNumber <= speciesCount;
      speciesNumber += 1
    ) {
      plants.push({
        speciesNumber:
          speciesNumber,

        koreanName:
          document.getElementById(
            `species${speciesNumber}KoreanName`
          ).value.trim(),

        scientificName:
          document.getElementById(
            `species${speciesNumber}ScientificName`
          ).value.trim(),

        discoveryDate:
          document.getElementById(
            `species${speciesNumber}Date`
          ).value,

        discoveryPlace:
          document.getElementById(
            `species${speciesNumber}Place`
          ).value.trim(),

        habitat:
          document.getElementById(
            `species${speciesNumber}Habitat`
          ).value.trim(),

        features:
          document.getElementById(
            `species${speciesNumber}Features`
          ).value.trim(),

        references:
          document.getElementById(
            `species${speciesNumber}References`
          ).value.trim()
      });
    }

    const completedPlantCount =
      plants.filter(function (plant) {
        return Boolean(
          plant.koreanName &&
          plant.scientificName &&
          plant.discoveryDate &&
          plant.discoveryPlace &&
          plant.habitat &&
          plant.features &&
          plant.references
        );
      }).length;

    const everythingCompleted =
      completedPlantCount ===
        speciesCount &&
      selectionReasonInput.value.trim() !==
        "" &&
      inquiryPlantInput.value.trim() !==
        "" &&
      inquiryTopicInput.value.trim() !==
        "" &&
      reflectionInput.value.trim() !==
        "";

    if (!everythingCompleted) {
      const shouldSave =
        window.confirm(
          `현재 완전히 작성된 식물은 ${completedPlantCount}종입니다.\n\n` +
          "작성되지 않은 항목이 있지만 현재 내용까지 저장하시겠습니까?"
        );

      if (!shouldSave) {
        return;
      }
    }

    const originalButtonText =
      submitPlantButton.textContent;

    submitPlantButton.disabled = true;
    submitPlantButton.textContent =
      "저장 중...";

    hideMessage(plantFormMessage);

    const submissionRequest = {
      sessionToken:
        currentStudentToken,

      selectionReason:
        selectionReasonInput.value.trim(),

      inquiryPlant:
        inquiryPlantInput.value.trim(),

      inquiryTopic:
        inquiryTopicInput.value.trim(),

      reflection:
        reflectionInput.value.trim(),

      plants:
        plants
    };

    let textSaved = false;

    try {
      // 사진보다 작성 내용을 먼저 저장하여
      // 업로드 중 연결이 끊겨도 글이 사라지지 않게 함
      submitPlantButton.textContent =
        "식물 기록 저장 중...";

      const result =
        await callPlantGuideApiWithRetry(
          "saveSubmission",
          submissionRequest
        );

      if (!result.success) {
        showMessage(
          plantFormMessage,
          result.message ||
            "기록을 저장하지 못했습니다.",
          "error"
        );

        return;
      }

      textSaved = true;

      temporaryLastSavedAt =
        result.savedAt
          ? new Date(result.savedAt)
          : new Date();

      const selectedPhotoCount =
        countSelectedPhotos();

      if (selectedPhotoCount > 0) {
        await uploadSelectedPlantPhotos(
          function (current, total) {
            submitPlantButton.textContent =
              `사진 업로드 중 ${current} / ${total}`;
          }
        );

        // 사진 수가 교사 화면에 즉시 반영되도록
        // 사진 완료 후 제출 현황만 한 번 더 갱신
        const finalResult =
          await callPlantGuideApiWithRetry(
            "saveSubmission",
            submissionRequest
          );

        if (finalResult.success) {
          temporaryLastSavedAt =
            finalResult.savedAt
              ? new Date(finalResult.savedAt)
              : new Date();
        }
      }

      // 글과 선택한 사진이 모두 저장된 뒤에만
      // 최종 저장 완료 상태로 전환한다.
      plantFormHasUnsavedChanges = false;
      clearLocalPlantDraft();

      showMessage(
        plantFormMessage,
        selectedPhotoCount > 0
          ? "내용과 사진이 모두 저장되었습니다."
          : "내용이 저장되었습니다.",
        "success"
      );

      window.alert(
        selectedPhotoCount > 0
          ? "내용과 사진이 모두 저장되었습니다."
          : "내용이 저장되었습니다."
      );

      updateSpeciesProgress();
    } catch (error) {
      console.error(error);

      if (textSaved) {
        // 사진 업로드가 끝나지 않은 경우에는 작성 중 상태와
        // 브라우저 임시 저장을 유지한다. 다시 저장하면 이미
        // 성공한 사진은 건너뛰고 남은 사진만 이어서 업로드한다.
        plantFormHasUnsavedChanges = true;
        saveLocalPlantDraft();

        showMessage(
          plantFormMessage,
          "저장이 완료되지 않았습니다. 저장 버튼을 다시 눌러주세요.",
          "error"
        );

        window.alert(
          "저장이 완료되지 않았습니다. 인터넷 연결을 확인한 뒤 저장 버튼을 다시 눌러주세요."
        );
      } else {
        showMessage(
          plantFormMessage,
          "서버가 혼잡하거나 연결이 불안정합니다. 작성 내용은 이 기기에 임시 저장되었습니다. 잠시 후 다시 제출해주세요.",
          "error"
        );
      }
    } finally {
      submitPlantButton.disabled = false;
      submitPlantButton.textContent =
        originalButtonText;
    }
  }
);

// 교사 로그인 및 대시보드
const teacherStartButton =
  document.getElementById("teacherStartButton");

const teacherLoginSection =
  document.getElementById("teacherLoginSection");

const teacherDashboardSection =
  document.getElementById(
    "teacherDashboardSection"
  );

const teacherLoginBackButton =
  document.getElementById(
    "teacherLoginBackButton"
  );

const teacherLoginForm =
  document.getElementById("teacherLoginForm");

const teacherPasswordInput =
  document.getElementById("teacherPassword");

const teacherLoginMessage =
  document.getElementById(
    "teacherLoginMessage"
  );

const teacherLogoutButton =
  document.getElementById(
    "teacherLogoutButton"
  );

const refreshRecordsButton =
  document.getElementById("refreshRecordsButton");

const refreshStudentsButton =
  document.getElementById("refreshStudentsButton");

const refreshViewsButton =
  document.getElementById("refreshViewsButton");

const downloadRecordsButton =
  document.getElementById("downloadRecordsButton");

const teacherRecordSearch =
  document.getElementById("teacherRecordSearch");

const teacherStudentSearch =
  document.getElementById("teacherStudentSearch");

const teacherViewSearch =
  document.getElementById("teacherViewSearch");

// 서버에서 발급받은 교사 로그인 토큰
let currentTeacherToken = null;

// 교사 로그인 화면 열기
teacherStartButton.addEventListener(
  "click",
  function () {
    teacherLoginForm.reset();
    hideMessage(teacherLoginMessage);

    showOnlySection(teacherLoginSection);
    teacherPasswordInput.focus();
    window.scrollTo(0, 0);
  }
);

// 교사 로그인 화면에서 돌아가기
teacherLoginBackButton.addEventListener(
  "click",
  function () {
    teacherLoginForm.reset();
    hideMessage(teacherLoginMessage);

    showOnlySection(welcomeSection);
    window.scrollTo(0, 0);
  }
);

// Supabase 서버 교사 로그인
teacherLoginForm.addEventListener(
  "submit",
  async function (event) {
    event.preventDefault();

    const enteredPassword =
      teacherPasswordInput.value;

    if (!enteredPassword) {
      showMessage(
        teacherLoginMessage,
        "교사 비밀번호를 입력해주세요.",
        "error"
      );

      return;
    }

    const loginButton =
      teacherLoginForm.querySelector(
        "button[type='submit']"
      );

    const originalText =
      loginButton.textContent;

    loginButton.disabled = true;
    loginButton.textContent =
      "교사 인증 중...";

    hideMessage(teacherLoginMessage);

    try {
      const loginResult =
        await callPlantGuideApi(
          "teacherLogin",
          {
            teacherPassword:
              enteredPassword
          }
        );

      if (!loginResult.success) {
        showMessage(
          teacherLoginMessage,
          loginResult.message ||
            "교사 로그인에 실패했습니다.",
          "error"
        );

        return;
      }

      if (
        !loginResult.teacherSessionToken
      ) {
        throw new Error(
          "교사 로그인 토큰을 발급받지 못했습니다."
        );
      }

      currentTeacherToken =
        loginResult.teacherSessionToken;

      const loaded =
        await loadTeacherDashboard();

      if (!loaded) {
        return;
      }

      teacherLoginForm.reset();
      hideMessage(teacherLoginMessage);

      showOnlySection(
        teacherDashboardSection
      );

      openDashboardPanel("records");
      window.scrollTo(0, 0);
    } catch (error) {
      console.error(error);

      showMessage(
        teacherLoginMessage,
        "서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
        "error"
      );
    } finally {
      loginButton.disabled = false;
      loginButton.textContent =
        originalText;
    }
  }
);

// 교사 로그아웃
teacherLogoutButton.addEventListener(
  "click",
  async function () {
    const shouldLogout =
      window.confirm(
        "교사 대시보드에서 로그아웃하시겠습니까?"
      );

    if (!shouldLogout) {
      return;
    }

    const tokenToDelete =
      currentTeacherToken;

    try {
      if (tokenToDelete) {
        await callPlantGuideApi(
          "teacherLogout",
          {
            teacherSessionToken:
              tokenToDelete
          }
        );
      }
    } catch (error) {
      console.error(
        "교사 서버 로그아웃 처리 실패:",
        error
      );
    }

    currentTeacherToken = null;
    currentTeacherSubmission = null;

    teacherDashboardData = {
      students: [],
      submissions: [],
      views: []
    };

    teacherLoginForm.reset();
    closeTeacherSubmissionModal();

    totalStudentCount.textContent = "0";
    submittedStudentCount.textContent = "0";
    totalPlantCount.textContent = "0";
    incompleteRecordCount.textContent = "0";

    teacherRecordsTableBody.innerHTML = "";
    teacherStudentsTableBody.innerHTML = "";
    teacherViewsTableBody.innerHTML = "";

    showOnlySection(welcomeSection);
    window.scrollTo(0, 0);
  }
);

// 대시보드 탭
const dashboardTabs =
  document.querySelectorAll(
    "[data-dashboard-tab]"
  );

const dashboardPanels = {
  records:
    document.getElementById(
      "teacherRecordsPanel"
    ),

  students:
    document.getElementById(
      "teacherStudentsPanel"
    ),

  views:
    document.getElementById(
      "teacherViewsPanel"
    )
};

dashboardTabs.forEach(function (tab) {
  tab.addEventListener("click", function () {
    openDashboardPanel(
      tab.dataset.dashboardTab
    );
  });
});

// 선택한 대시보드 패널 표시
function openDashboardPanel(panelName) {
  dashboardTabs.forEach(function (tab) {
    tab.classList.toggle(
      "active",
      tab.dataset.dashboardTab === panelName
    );
  });

  Object.entries(
    dashboardPanels
  ).forEach(function (entry) {
    const name = entry[0];
    const panel = entry[1];

    panel.classList.toggle(
      "hidden",
      name !== panelName
    );
  });
}

refreshRecordsButton.addEventListener("click", loadTeacherDashboard);
refreshStudentsButton.addEventListener("click", loadTeacherDashboard);
refreshViewsButton.addEventListener("click", loadTeacherDashboard);

teacherRecordSearch.addEventListener("input", function () {
  const keyword = teacherRecordSearch.value.trim().toLowerCase();
  const filtered = teacherDashboardData.submissions.filter(function (item) {
    return [item.studentNumber, item.studentName, item.plantNames]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });
  renderTeacherSubmissions(filtered);
});

teacherStudentSearch.addEventListener("input", function () {
  const keyword = teacherStudentSearch.value.trim().toLowerCase();
  const filtered = teacherDashboardData.students.filter(function (item) {
    return [item.studentNumber, item.studentName]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });
  renderTeacherStudents(filtered);
});

teacherViewSearch.addEventListener("input", function () {
  const keyword = teacherViewSearch.value.trim().toLowerCase();
  const filtered = teacherDashboardData.views.filter(function (item) {
    return [
      item.viewerStudentNumber,
      item.viewerStudentName,
      item.targetStudentNumber,
      item.targetStudentName,
      item.koreanName
    ].join(" ").toLowerCase().includes(keyword);
  });
  renderTeacherViews(filtered);
});

downloadRecordsButton.addEventListener("click", downloadTeacherCsv);

async function downloadTeacherCsv() {
  if (!currentTeacherToken) {
    return;
  }

  const originalText = downloadRecordsButton.textContent;
  downloadRecordsButton.disabled = true;
  downloadRecordsButton.textContent = "CSV 생성 중...";

  try {
    const result = await callPlantGuideApi("exportTeacherCsv", {
      teacherSessionToken: currentTeacherToken
    });

    if (!result.success) {
      throw new Error(result.message || "CSV 자료를 만들지 못했습니다.");
    }

    const columns = [
      ["studentNumber", "학번"],
      ["studentName", "이름"],
      ["speciesNumber", "식물번호"],
      ["koreanName", "국명"],
      ["scientificName", "학명"],
      ["discoveryDate", "발견날짜"],
      ["discoveryPlace", "발견장소"],
      ["habitat", "서식환경"],
      ["features", "식물특징"],
      ["references", "식물별참고자료및출처"],
      ["plantStatus", "식물작성상태"],
      ["selectionReason", "5종식물선택이유"],
      ["inquiryPlant", "탐구하고싶은식물"],
      ["inquiryTopic", "탐구주제"],
      ["reflection", "느낀점"],
      ["submissionStatus", "전체작성상태"],
      ["visibility", "공개상태"],
      ["updatedAt", "최근저장일시"]
    ];

    const rows = Array.isArray(result.rows) ? result.rows : [];
    const csvLines = [
      columns.map(function (column) {
        return csvCell(column[1]);
      }).join(",")
    ];

    rows.forEach(function (row) {
      csvLines.push(
        columns.map(function (column) {
          return csvCell(row[column[0]]);
        }).join(",")
      );
    });

    const blob = new Blob(
      ["\ufeff" + csvLines.join("\r\n")],
      { type: "text/csv;charset=utf-8" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `식물도감_전체자료_${today}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error(error);
    window.alert(error.message || "CSV 다운로드 중 오류가 발생했습니다.");
  } finally {
    downloadRecordsButton.disabled = false;
    downloadRecordsButton.textContent = originalText;
  }
}

function csvCell(value) {
  let text = value == null ? "" : String(value);

  if (/^[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

// 공동 식물도감
const sharedGuideSection =
  document.getElementById("sharedGuideSection");

const sharedGuideBackButton =
  document.getElementById(
    "sharedGuideBackButton"
  );

const sharedGuideSearch =
  document.getElementById("sharedGuideSearch");

const sharedGuideStatusFilter =
  document.getElementById(
    "sharedGuideStatusFilter"
  );

const sharedGuideGrid =
  document.getElementById("sharedGuideGrid");

const sharedGuideNoResults =
  document.getElementById(
    "sharedGuideNoResults"
  );

const sharedGuidePlantCount =
  document.getElementById(
    "sharedGuidePlantCount"
  );

const viewerWatermark =
  document.getElementById("viewerWatermark");

// 상세 화면
const plantDetailModal =
  document.getElementById("plantDetailModal");

const plantDetailCloseButton =
  document.getElementById(
    "plantDetailCloseButton"
  );

const plantDetailOverlay =
  document.querySelector(
    ".plant-detail-overlay"
  );

const plantDetailStatus =
  document.getElementById(
    "plantDetailStatus"
  );

const plantDetailTitle =
  document.getElementById(
    "plantDetailTitle"
  );

const plantDetailScientificName =
  document.getElementById(
    "plantDetailScientificName"
  );

const plantDetailPhotos =
  document.getElementById(
    "plantDetailPhotos"
  );

const plantDetailInformation =
  document.getElementById(
    "plantDetailInformation"
  );

const detailViewerInformation =
  document.getElementById(
    "detailViewerInformation"
  );

// 서버에서 불러온 실제 공동 도감 자료
let sharedPlants = [];

// Supabase의 공동 식물도감 열기
viewGuideButton.addEventListener(
  "click",
  async function () {
    if (
      !currentStudent ||
      !currentStudentToken
    ) {
      window.alert(
        "로그인 정보가 만료되었습니다. 다시 로그인해주세요."
      );

      showOnlySection(loginSection);
      return;
    }

    closePlantDetail();

    sharedGuideSearch.value = "";
    sharedGuideStatusFilter.value = "all";

    updateViewerWatermark();

    showOnlySection(sharedGuideSection);
    window.scrollTo(0, 0);

    sharedGuideGrid.innerHTML = `
      <div class="guide-empty-state">
        <span>⏳</span>
        <strong>식물도감을 불러오는 중입니다.</strong>
        <p>잠시만 기다려주세요.</p>
      </div>
    `;

    try {
      const result =
        await callPlantGuideApi(
          "getSharedPlants",
          {
            sessionToken:
              currentStudentToken
           }
        );

      if (!result.success) {
        throw new Error(
          result.message ||
          "공동 식물도감을 불러오지 못했습니다."
        );
      }

      sharedPlants =
        Array.isArray(result.plants)
          ? result.plants
          : [];

      renderSharedGuide(sharedPlants);
    } catch (error) {
      console.error(error);

      sharedPlants = [];

      sharedGuidePlantCount.textContent =
        "0";

      sharedGuideGrid.innerHTML = `
        <div class="guide-empty-state">
          <span>⚠️</span>
          <strong>식물도감을 불러오지 못했습니다.</strong>
          <p>
            인터넷 연결과 Supabase 연결 상태를
            확인한 후 다시 시도해주세요.
          </p>
        </div>
      `;
    }
  }
);

// 학생 메뉴로 돌아가기
sharedGuideBackButton.addEventListener(
  "click",
  function () {
    closePlantDetail();
    showOnlySection(studentMenuSection);
    window.scrollTo(0, 0);
  }
);

// 검색 및 필터
sharedGuideSearch.addEventListener(
  "input",
  filterSharedGuide
);

sharedGuideStatusFilter.addEventListener(
  "change",
  filterSharedGuide
);

function filterSharedGuide() {
  const searchTerm =
    sharedGuideSearch.value
      .trim()
      .toLowerCase();

  const selectedStatus =
    sharedGuideStatusFilter.value;

  const filteredPlants =
    sharedPlants.filter(
      function (plant) {
        const searchableText = [
          plant.koreanName,
          plant.scientificName,
          plant.discoveryPlace
        ]
          .join(" ")
          .toLowerCase();

        const matchesSearch =
          searchableText.includes(searchTerm);

        const matchesStatus =
          selectedStatus === "all" ||
          plant.status === selectedStatus;

        return matchesSearch && matchesStatus;
      }
    );

  renderSharedGuide(filteredPlants);
}

// 식물 카드 표시
function renderSharedGuide(plants) {
  sharedGuideGrid.innerHTML = "";

  sharedGuidePlantCount.textContent =
    plants.length;

  if (plants.length === 0) {
    sharedGuideNoResults.classList.remove(
      "hidden"
    );

    return;
  }

  sharedGuideNoResults.classList.add(
    "hidden"
  );

  plants.forEach(function (plant) {
    const card =
      document.createElement("article");

    card.className = "plant-guide-card";
    card.tabIndex = 0;

    const completed =
      plant.status === "completed";
    
    const wholePhotoUrl =
      getSafePhotoUrl(
        plant.photos &&
        plant.photos.Whole
          ? plant.photos.Whole.photoUrl
          : ""
      );

    const cardImageHtml =
      wholePhotoUrl
        ? `
          <img
            src="${wholePhotoUrl}"
            alt="${escapeRecordText(
              plant.koreanName
            )} 전체 사진"
            loading="lazy"
            referrerpolicy="no-referrer"
          >
        `
        : `
          <div class="plant-card-image-placeholder">
            🌿
          </div>
        `;

    card.innerHTML = `
      <div class="plant-card-image">
        ${cardImageHtml}

        <span
          class="plant-status-badge plant-card-status
          ${completed ? "" : "incomplete"}"
        >
          ${completed ? "작성 완료" : "작성 중"}
        </span>
      </div>

      <div class="plant-card-body">
        <h3>${escapeRecordText(plant.koreanName)}</h3>

        <p class="plant-card-scientific-name">
          ${escapeRecordText(plant.scientificName)}
        </p>

        <div class="plant-card-meta">
          <p>📍 ${escapeRecordText(plant.discoveryPlace)}</p>
          <p>📅 ${escapeRecordText(plant.discoveryDate)}</p>
        </div>
       
      </div>
    `;

    card.addEventListener("click", function () {
      openPlantDetail(plant);
    });

    card.addEventListener(
      "keydown",
      function (event) {
        if (
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault();
          openPlantDetail(plant);
        }
      }
    );

    sharedGuideGrid.appendChild(card);
  });
}

// 상세 화면 열기
function openPlantDetail(plant) {
  const completed =
    plant.status === "completed";

  plantDetailStatus.textContent =
    completed ? "작성 완료" : "작성 중";

  plantDetailStatus.classList.toggle(
    "incomplete",
    !completed
  );

  plantDetailTitle.textContent =
    plant.koreanName;

  plantDetailScientificName.textContent =
    plant.scientificName;

  plantDetailPhotos.innerHTML = `
  ${createDetailPhoto(
    plant.photos
      ? plant.photos.Leaf
      : null,
    "잎 사진",
    "🍃"
  )}

  ${createDetailPhoto(
    plant.photos
      ? plant.photos.Stem
      : null,
    "줄기 사진",
    "🌱"
  )}

  ${createDetailPhoto(
    plant.photos
      ? plant.photos.Whole
      : null,
    "식물 전체 사진",
    "🌿"
  )}
`;

  plantDetailInformation.innerHTML = `
    ${createDetailInfo(
      "발견 날짜",
      plant.discoveryDate
    )}

    ${createDetailInfo(
      "발견 장소",
      plant.discoveryPlace
    )}

    ${createDetailInfo(
      "서식 환경",
      plant.habitat
    )}

    ${createDetailInfo(
      "식물 특징",
      plant.features
    )}

    ${createDetailInfo(
      "참고자료 및 출처",
      plant.references || "아직 작성되지 않았습니다."
    )}

   `;

  detailViewerInformation.textContent =
    `${currentStudent.studentNumber} ` +
    `${currentStudent.studentName} 학생의 ` +
    "열람 정보가 기록됩니다.";

  plantDetailModal.classList.remove(
    "hidden"
  );

  document.body.classList.add(
    "modal-open"
  );
  savePlantViewRecord(plant);
}


// 상세 사진 임시 화면
function createDetailPhoto(
  photo,
  label,
  placeholderIcon
) {
  const safePhotoUrl =
    getSafePhotoUrl(
      photo && photo.photoUrl
        ? photo.photoUrl
        : ""
    );

  const safeLabel =
    escapeRecordText(label);

  const safePlaceholderIcon =
    escapeRecordText(placeholderIcon);

  const photoContent =
    safePhotoUrl
      ? `
        <img
          src="${safePhotoUrl}"
          alt="${safeLabel}"
          loading="lazy"
          referrerpolicy="no-referrer"
        >
      `
      : `
        <div
          class="plant-card-image-placeholder"
          style="aspect-ratio: 4 / 3;"
        >
          ${safePlaceholderIcon}
        </div>
      `;

  return `
    <div class="detail-photo">
      ${photoContent}
      <p>${safeLabel}</p>
    </div>
  `;
}

// 상세 정보 항목
function createDetailInfo(title, content) {
  return `
    <div class="detail-info-item">
      <strong>${escapeRecordText(title)}</strong>
      <p>${escapeRecordText(content)}</p>
    </div>
  `;
}

// 상세 화면 닫기
function closePlantDetail() {
  plantDetailModal.classList.add("hidden");

  document.body.classList.remove(
    "modal-open"
  );
}

plantDetailCloseButton.addEventListener(
  "click",
  closePlantDetail
);

plantDetailOverlay.addEventListener(
  "click",
  closePlantDetail
);

document.addEventListener(
  "keydown",
  function (event) {
    if (
      event.key === "Escape" &&
      !plantDetailModal.classList.contains(
        "hidden"
      )
    ) {
      closePlantDetail();
    }
  }
);

// 열람자 워터마크
function updateViewerWatermark() {
  if (!currentStudent) {
    viewerWatermark.textContent = "";
    return;
  }

  const now =
    new Date().toLocaleString("ko-KR");

  viewerWatermark.textContent =
    `${currentStudent.studentNumber} ` +
    `${currentStudent.studentName} · ${now}`;
}

// 공동 도감 복사·저장 동작 억제
sharedGuideSection.addEventListener(
  "contextmenu",
  function (event) {
    event.preventDefault();
  }
);

sharedGuideSection.addEventListener(
  "copy",
  function (event) {
    event.preventDefault();
  }
);

sharedGuideSection.addEventListener(
  "dragstart",
  function (event) {
    event.preventDefault();
  }
);

plantDetailModal.addEventListener(
  "contextmenu",
  function (event) {
    event.preventDefault();
  }
);

plantDetailModal.addEventListener(
  "copy",
  function (event) {
    event.preventDefault();
  }
);

plantDetailModal.addEventListener(
  "dragstart",
  function (event) {
    event.preventDefault();
  }
);

// 나의 기록 화면
const myRecordsSection =
  document.getElementById("myRecordsSection");

const myRecordsBackButton =
  document.getElementById(
    "myRecordsBackButton"
  );

const continueWritingButton =
  document.getElementById(
    "continueWritingButton"
  );

const myRecordsWriteButton =
  document.getElementById(
    "myRecordsWriteButton"
  );

const editCommonRecordButton =
  document.getElementById(
    "editCommonRecordButton"
  );

const myCompletedPlantCount =
  document.getElementById(
    "myCompletedPlantCount"
  );

const myUploadedPhotoCount =
  document.getElementById(
    "myUploadedPhotoCount"
  );

const myLastSavedTime =
  document.getElementById(
    "myLastSavedTime"
  );

const myRecordProgressText =
  document.getElementById(
    "myRecordProgressText"
  );

const myRecordProgressBar =
  document.getElementById(
    "myRecordProgressBar"
  );

const myPlantRecordsGrid =
  document.getElementById(
    "myPlantRecordsGrid"
  );

const mySelectionReasonContent =
  document.getElementById(
    "mySelectionReasonContent"
  );

const myInquiryPlantContent =
  document.getElementById(
    "myInquiryPlantContent"
  );

const myInquiryTopicContent =
  document.getElementById(
    "myInquiryTopicContent"
  );

const myReflectionContent =
  document.getElementById(
    "myReflectionContent"
  );

// 최근 저장 시각
let temporaryLastSavedAt = null;

// 나의 기록 화면 열기
myRecordsButton.addEventListener(
  "click",
  function () {
    renderMyRecords();

    showOnlySection(myRecordsSection);
    window.scrollTo(0, 0);
  }
);

// 학생 메뉴로 돌아가기
myRecordsBackButton.addEventListener(
  "click",
  function () {
    showOnlySection(studentMenuSection);
    window.scrollTo(0, 0);
  }
);

// 기록 작성 화면 열기
continueWritingButton.addEventListener(
  "click",
  function () {
    openMyPlantEditor(0);
  }
);

myRecordsWriteButton.addEventListener(
  "click",
  function () {
    openMyPlantEditor(0);
  }
);

// 공통 기록 수정
editCommonRecordButton.addEventListener(
  "click",
  function () {
    showOnlySection(plantFormSection);
    showSpecies(speciesCount);

    window.scrollTo({
      top: plantFormSection.offsetTop,
      behavior: "smooth"
    });

    selectionReasonInput.focus();
  }
);

// 선택한 식물 수정
function openMyPlantEditor(index) {
  showOnlySection(plantFormSection);
  showSpecies(index);

  window.scrollTo({
    top: plantFormSection.offsetTop,
    behavior: "smooth"
  });
}

// 나의 기록 표시
function renderMyRecords() {
  let completedPlantCount = 0;
  let uploadedPhotoCount = 0;

  myPlantRecordsGrid.innerHTML = "";

  for (
    let index = 0;
    index < speciesCount;
    index += 1
  ) {
    const speciesNumber = index + 1;

    const koreanName =
      document.getElementById(
        `species${speciesNumber}KoreanName`
      ).value.trim();

    const scientificName =
      document.getElementById(
        `species${speciesNumber}ScientificName`
      ).value.trim();

    const complete =
      isSpeciesComplete(index);

    if (complete) {
      completedPlantCount += 1;
    }

    const leafInput =
      document.getElementById(
        `species${speciesNumber}LeafPhoto`
      );

    const stemInput =
      document.getElementById(
        `species${speciesNumber}StemPhoto`
      );

    const wholeInput =
      document.getElementById(
        `species${speciesNumber}WholePhoto`
      );

    const photoInputs = [
      leafInput,
      stemInput,
      wholeInput
    ];

    const photoTypes = [
      "Leaf",
      "Stem",
      "Whole"
    ];

    photoInputs.forEach(function (
      input,
      photoIndex
    ) {
      const photoType =
        photoTypes[photoIndex];

      const savedPhotoExists =
        savedPhotoMap.has(
          getSavedPhotoKey(
            speciesNumber,
            photoType
          )
        );

      if (
        input.files.length > 0 ||
        savedPhotoExists
      ) {
        uploadedPhotoCount += 1;
      }
    });

    const wholePreview =
      document.querySelector(
        `#species${speciesNumber}WholePreview img`
      );

    const card =
      document.createElement("article");

    card.className = "my-plant-record-card";

    const imageContent =
      wholePreview
        ? `<img
            src="${wholePreview.src}"
            alt="식물 ${speciesNumber} 전체 사진"
          >`
        : "🌱";

    card.innerHTML = `
      <div class="my-record-card-image">
        ${imageContent}
      </div>

      <div class="my-record-card-body">
        <span class="my-record-number">
          식물 ${speciesNumber}
        </span>

        <h3>
          ${escapeRecordText(
            koreanName || "미작성"
          )}
        </h3>

        <p>
          ${escapeRecordText(
            scientificName || "학명 미작성"
          )}
        </p>

        <div class="my-record-card-footer">
          <span
            class="my-record-status
            ${complete ? "completed" : ""}"
          >
            ${complete ? "작성 완료 ✓" : "작성 중"}
          </span>

          <button
            class="record-edit-button"
            type="button"
            data-edit-species="${index}"
          >
            수정
          </button>
        </div>
      </div>
    `;

    myPlantRecordsGrid.appendChild(card);
  }

  // 수정 버튼 연결
  const editButtons =
    myPlantRecordsGrid.querySelectorAll(
      "[data-edit-species]"
    );

  editButtons.forEach(function (button) {
    button.addEventListener(
      "click",
      function () {
        openMyPlantEditor(
          Number(button.dataset.editSpecies)
        );
      }
    );
  });

  // 작성 현황
  myCompletedPlantCount.textContent =
    `${completedPlantCount} / ${speciesCount}`;

  myUploadedPhotoCount.textContent =
    `${uploadedPhotoCount} / 15`;

  if (temporaryLastSavedAt) {
    myLastSavedTime.textContent =
      temporaryLastSavedAt.toLocaleString(
        "ko-KR",
        {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }
      );
  } else {
    myLastSavedTime.textContent =
      "저장 기록 없음";
  }

  // 마무리 작성
  const selectionReason =
    selectionReasonInput.value.trim();

  const inquiryPlant =
    inquiryPlantInput.value.trim();

  const inquiryTopic =
    inquiryTopicInput.value.trim();

  const reflection =
    reflectionInput.value.trim();

  mySelectionReasonContent.textContent =
    selectionReason ||
    "아직 작성되지 않았습니다.";

  myInquiryPlantContent.textContent =
    inquiryPlant ||
    "아직 작성되지 않았습니다.";

  myInquiryTopicContent.textContent =
    inquiryTopic ||
    "아직 작성되지 않았습니다.";

  myReflectionContent.textContent =
    reflection ||
    "아직 작성되지 않았습니다.";

  const commonRecordCompleted =
    selectionReason !== "" &&
    inquiryPlant !== "" &&
    inquiryTopic !== "" &&
    reflection !== "";

  const completedSteps =
    completedPlantCount +
    (commonRecordCompleted ? 1 : 0);

  const progressPercent =
    Math.round(
      (completedSteps / 6) * 100
    );

  myRecordProgressText.textContent =
    `${progressPercent}%`;

  myRecordProgressBar.style.width =
    `${progressPercent}%`;
}

// 학생 입력값을 안전하게 카드에 표시
function escapeRecordText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Supabase Storage 사진 주소인지 안전하게 확인
function getSafePhotoUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(String(value));

    if (url.protocol !== "https:") {
      return "";
    }

    const allowedHosts = [];

    if (SUPABASE_URL) {
      allowedHosts.push(
        new URL(SUPABASE_URL).hostname
      );
    }

    const hostAllowed = allowedHosts.some(
      function (allowedHost) {
        return (
          url.hostname === allowedHost ||
          url.hostname.endsWith(
            "." + allowedHost
          )
        );
      }
    );

    return hostAllowed
      ? escapeRecordText(url.href)
      : "";
  } catch (error) {
    return "";
  }
}

// 공동 도감 복사 단축키 차단
function blockGuideCopyShortcuts(event) {
  const target = event.target;

  const isSearchControl =
    target.matches("input, select, option");

  // 검색창에서는 글자 선택과 편집 허용
  if (isSearchControl) {
    return;
  }

  const controlPressed =
    event.ctrlKey || event.metaKey;

  if (!controlPressed) {
    return;
  }

  const blockedKeys = [
    "c",
    "x",
    "a",
    "s",
    "p"
  ];

  if (
    blockedKeys.includes(
      event.key.toLowerCase()
    )
  ) {
    event.preventDefault();

    window.alert(
      "친구의 식물도감 내용은 열람만 가능하며 복사하거나 저장할 수 없습니다."
    );
  }
}

sharedGuideSection.addEventListener(
  "keydown",
  blockGuideCopyShortcuts
);

plantDetailModal.addEventListener(
  "keydown",
  blockGuideCopyShortcuts
);

// 텍스트 선택 시작 억제
sharedGuideSection.addEventListener(
  "selectstart",
  function (event) {
    if (
      !event.target.matches(
        "input, select, option"
      )
    ) {
      event.preventDefault();
    }
  }
);

plantDetailModal.addEventListener(
  "selectstart",
  function (event) {
    event.preventDefault();
  }
);

// 인쇄 메뉴 호출 억제
window.addEventListener(
  "beforeprint",
  function () {
    if (
      !sharedGuideSection.classList.contains(
        "hidden"
      ) ||
      !plantDetailModal.classList.contains(
        "hidden"
      )
    ) {
      window.alert(
        "공동 식물도감 내용은 인쇄할 수 없습니다."
      );
    }
  }
);

// 현재 로그인 학생의 브라우저 임시저장 키
function getLocalPlantDraftKey() {
  if (
    !currentStudent ||
    !currentStudent.studentNumber
  ) {
    return null;
  }

  return (
    "plantGuideDraft_" +
    String(currentStudent.studentNumber)
  );
}

// 입력 내용이 바뀌면 잠시 후 자동 임시저장
function markPlantFormAsChanged() {
  if (!currentStudent) {
    return;
  }

  plantFormHasUnsavedChanges = true;

  if (plantDraftSaveTimer) {
    window.clearTimeout(
      plantDraftSaveTimer
    );
  }

  plantDraftSaveTimer =
    window.setTimeout(
      saveLocalPlantDraft,
      500
    );
}

// 사진을 제외한 작성 내용을 브라우저에 임시저장
function saveLocalPlantDraft() {
  if (plantDraftSaveTimer) {
    window.clearTimeout(
      plantDraftSaveTimer
    );
    plantDraftSaveTimer = null;
  }

  if (!plantFormHasUnsavedChanges) {
    return;
  }

  const draftKey =
    getLocalPlantDraftKey();

  if (!draftKey) {
    return;
  }

  const values = {};

  plantRecordForm
    .querySelectorAll(
      "input:not([type='file']), textarea, select"
    )
    .forEach(function (element) {
      const key =
        element.name || element.id;

      if (!key) {
        return;
      }

      if (
        element.type === "checkbox" ||
        element.type === "radio"
      ) {
        values[key] = element.checked;
      } else {
        values[key] = element.value;
      }
    });

  try {
    window.localStorage.setItem(
      draftKey,
      JSON.stringify({
        savedAt: Date.now(),
        values: values
      })
    );
  } catch (error) {
    console.error(
      "작성 내용 임시저장 실패:",
      error
    );
  }
}

// 서버 기록보다 새로운 브라우저 초안이 있으면 복구
function restoreLocalPlantDraft(
  serverUpdatedAt
) {
  const draftKey =
    getLocalPlantDraftKey();

  if (!draftKey) {
    return false;
  }

  try {
    const savedDraft =
      window.localStorage.getItem(
        draftKey
      );

    if (!savedDraft) {
      return false;
    }

    const draft =
      JSON.parse(savedDraft);

    const draftSavedAt =
      Number(draft.savedAt || 0);

    const parsedServerSavedAt =
      serverUpdatedAt
        ? Date.parse(serverUpdatedAt)
        : 0;

    const serverSavedAt =
      Number.isFinite(parsedServerSavedAt)
        ? parsedServerSavedAt
        : 0;

    if (
      serverSavedAt > 0 &&
      draftSavedAt <= serverSavedAt
    ) {
      window.localStorage.removeItem(
        draftKey
      );
      plantFormHasUnsavedChanges = false;
      return false;
    }

    const values = draft.values || {};

    Object.keys(values).forEach(
      function (key) {
        const element =
          plantRecordForm.elements[key] ||
          document.getElementById(key);

        if (!element) {
          return;
        }

        if (
          element.type === "checkbox" ||
          element.type === "radio"
        ) {
          element.checked =
            Boolean(values[key]);
        } else if (
          element.type !== "file"
        ) {
          element.value =
            values[key] == null
              ? ""
              : String(values[key]);
        }
      }
    );

    plantFormHasUnsavedChanges = true;
    return true;
  } catch (error) {
    console.error(
      "작성 내용 임시저장 복구 실패:",
      error
    );
    return false;
  }
}

// 현재 학생의 브라우저 임시 초안 제거
function clearLocalPlantDraft() {
  if (plantDraftSaveTimer) {
    window.clearTimeout(
      plantDraftSaveTimer
    );
    plantDraftSaveTimer = null;
  }

  const draftKey =
    getLocalPlantDraftKey();

  if (!draftKey) {
    return;
  }

  try {
    window.localStorage.removeItem(
      draftKey
    );
  } catch (error) {
    console.error(
      "작성 내용 임시저장 삭제 실패:",
      error
    );
  }
}

// 화면 전환·종료 직전까지 입력한 내용 보존
document.addEventListener(
  "visibilitychange",
  function () {
    if (document.hidden) {
      saveLocalPlantDraft();
    }
  }
);

window.addEventListener(
  "pagehide",
  saveLocalPlantDraft
);

// Supabase에서 나의 저장 기록 불러오기
async function loadMySubmissionFromServer() {
  if (
    !currentStudent ||
    !currentStudentToken
  ) {
    return false;
  }

  try {
    const result =
      await callPlantGuideApi(
        "loadMySubmission",
        {
          sessionToken:
            currentStudentToken
        }
      );

    if (!result.success) {
      throw new Error(
        result.message ||
        "저장 기록을 불러오지 못했습니다."
      );
    }

    // 이전 로그인 학생의 브라우저 입력값 제거
    plantRecordForm.reset();
    hideMessage(plantFormMessage);
    
    savedPhotoMap.clear();
    temporaryLastSavedAt = null;
    plantFormHasUnsavedChanges = false;

    if (!result.hasSubmission) {
      restoreLocalPlantDraft(null);
      updateSpeciesProgress();
      return true;
    }

    // 식물 1~5 내용 입력
    result.plants.forEach(function (plant) {
      const speciesNumber =
        Number(plant.speciesNumber);

      if (
        speciesNumber < 1 ||
        speciesNumber > speciesCount
      ) {
        return;
      }

      setInputValue_(
        `species${speciesNumber}KoreanName`,
        plant.koreanName
      );

      setInputValue_(
        `species${speciesNumber}ScientificName`,
        plant.scientificName
      );

      setInputValue_(
        `species${speciesNumber}Date`,
        plant.discoveryDate
      );

      setInputValue_(
        `species${speciesNumber}Place`,
        plant.discoveryPlace
      );

      setInputValue_(
        `species${speciesNumber}Habitat`,
        plant.habitat
      );

      setInputValue_(
        `species${speciesNumber}Features`,
        plant.features
      );

      setInputValue_(
        `species${speciesNumber}References`,
        plant.references
      );
    });

    // Supabase Storage에 저장된 사진 불러오기
    if (Array.isArray(result.photos)) {
      result.photos.forEach(function (photo) {
        const speciesNumber =
          Number(photo.speciesNumber);

        const photoType =
          String(photo.photoType || "");

    if (
      speciesNumber < 1 ||
      speciesNumber > speciesCount
    ) {
      return;
    }

    if (
      !["Leaf", "Stem", "Whole"].includes(
        photoType
      )
    ) {
      return;
    }

    const key =
      getSavedPhotoKey(
        speciesNumber,
        photoType
      );

    savedPhotoMap.set(
      key,
      photo
    );

    showSavedPhotoPreview(photo);
  });
}

    // 마무리 작성 입력
    selectionReasonInput.value =
      result.submission.selectionReason || "";

    inquiryPlantInput.value =
      result.submission.inquiryPlant || "";

    inquiryTopicInput.value =
      result.submission.inquiryTopic || "";

    reflectionInput.value =
      result.submission.reflection || "";

    // 최근 저장 시각
    if (result.submission.updatedAt) {
      temporaryLastSavedAt =
        new Date(
          result.submission.updatedAt
        );
    }

    restoreLocalPlantDraft(
      result.submission.updatedAt
    );

    updateSpeciesProgress();

    return true;
  } catch (error) {
    console.error(error);

    window.alert(
      "Supabase에 저장된 기록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."
    );

    return false;
  }
}

// ID로 입력칸에 값 넣기
function setInputValue_(
  elementId,
  value
) {
  const element =
    document.getElementById(elementId);

  if (element) {
    element.value =
      value == null
        ? ""
        : String(value);
  }
}

// Supabase Storage에 저장된 사진 정보


// 저장된 사진 구분 키 만들기
function getSavedPhotoKey(
  speciesNumber,
  photoType
) {
  return (
    speciesNumber +
    "-" +
    photoType
  );
}

// 현재 새로 선택된 사진 개수
function countSelectedPhotos() {
  const photoInputs =
    document.querySelectorAll(
      '[data-species-photo="true"]'
    );

  return Array.from(
    photoInputs
  ).filter(function (input) {
    return input.files.length > 0;
  }).length;
}

// 새로 선택한 사진을 순서대로 업로드
async function uploadSelectedPlantPhotos(
  progressCallback
) {
  const photoTypes = [
    "Leaf",
    "Stem",
    "Whole"
  ];

  const uploadItems = [];

  for (
    let speciesNumber = 1;
    speciesNumber <= speciesCount;
    speciesNumber += 1
  ) {
    photoTypes.forEach(function (photoType) {
      const input =
        document.getElementById(
          `species${speciesNumber}${photoType}Photo`
        );

      if (
        input &&
        input.files.length > 0
      ) {
        uploadItems.push({
          speciesNumber:
            speciesNumber,

          photoType:
            photoType,

          input:
            input,

          file:
            input.files[0]
        });
      }
    });
  }

  for (
    let index = 0;
    index < uploadItems.length;
    index += 1
  ) {
    const item =
      uploadItems[index];

    if (progressCallback) {
      progressCallback(
        index + 1,
        uploadItems.length
      );
    }

    const compressed =
      await compressPlantPhoto(
        item.file
      );

    const result =
      await callPlantGuideApiWithRetry(
        "uploadPhoto",
        {
          sessionToken:
            currentStudentToken,

          speciesNumber:
            item.speciesNumber,

          photoType:
            item.photoType,

          fileName:
            item.file.name,

          mimeType:
            compressed.mimeType,

          base64Data:
            compressed.base64Data
        }
      );

    if (!result.success) {
      throw new Error(
        result.message ||
        "사진을 저장하지 못했습니다."
      );
    }

    const photo =
      result.photo;

    const key =
      getSavedPhotoKey(
        photo.speciesNumber,
        photo.photoType
      );

    savedPhotoMap.set(
      key,
      photo
    );

    // 다음 제출 때 같은 사진이 중복 업로드되지 않게 함
    item.input.value = "";
  }

  return uploadItems.length;
}

// 사진 자동 축소 및 JPEG 압축
function compressPlantPhoto(file) {
  return new Promise(function (
    resolve,
    reject
  ) {
    const image =
      new Image();

    const objectUrl =
      URL.createObjectURL(file);

    image.onload = function () {
      try {
        const maximumSize = 1400;

        let width =
          image.naturalWidth;

        let height =
          image.naturalHeight;

        if (
          width > maximumSize ||
          height > maximumSize
        ) {
          const ratio =
            Math.min(
              maximumSize / width,
              maximumSize / height
            );

          width =
            Math.round(width * ratio);

          height =
            Math.round(height * ratio);
        }

        const canvas =
          document.createElement("canvas");

        canvas.width = width;
        canvas.height = height;

        const context =
          canvas.getContext("2d");

        context.fillStyle = "#ffffff";

        context.fillRect(
          0,
          0,
          width,
          height
        );

        context.drawImage(
          image,
          0,
          0,
          width,
          height
        );

        canvas.toBlob(
          function (blob) {
            URL.revokeObjectURL(
              objectUrl
            );

            if (!blob) {
              reject(
                new Error(
                  "사진을 압축하지 못했습니다."
                )
              );

              return;
            }

            const reader =
              new FileReader();

            reader.onload =
              function () {
                resolve({
                  mimeType:
                    "image/jpeg",

                  base64Data:
                    reader.result
                });
              };

            reader.onerror =
              function () {
                reject(
                  new Error(
                    "사진 데이터를 읽지 못했습니다."
                  )
                );
              };

            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          0.78
        );
      } catch (error) {
        URL.revokeObjectURL(
          objectUrl
        );

        reject(error);
      }
    };

    image.onerror = function () {
      URL.revokeObjectURL(
        objectUrl
      );

      reject(
        new Error(
          "선택한 사진을 불러오지 못했습니다."
        )
      );
    };

    image.src = objectUrl;
  });
}

// Supabase Storage에 저장된 사진 미리보기 표시
function showSavedPhotoPreview(photo) {
  const speciesNumber =
    Number(photo.speciesNumber);

  const photoType =
    String(photo.photoType || "");

  const preview =
    document.getElementById(
      `species${speciesNumber}${photoType}Preview`
    );

  if (
    !preview ||
    !photo.photoUrl
  ) {
    return;
  }

  const image =
    document.createElement("img");

  image.src =
    photo.photoUrl;

  image.alt =
    getSavedPhotoLabel(photoType);

  image.loading = "lazy";

  image.addEventListener(
    "error",
    function () {
      preview.textContent =
        "사진을 불러올 수 없습니다.";
    }
  );

  preview.replaceChildren(image);
}

// 저장 사진 구분 이름
function getSavedPhotoLabel(photoType) {
  const labels = {
    Leaf: "잎 사진",
    Stem: "줄기 사진",
    Whole: "식물 전체 사진"
  };

  return (
    labels[photoType] ||
    "식물 사진"
  );
}

// 식물 상세 열람 기록 저장
async function savePlantViewRecord(plant) {
  if (
    !currentStudent ||
    !currentStudentToken
  ) {
    return;
  }

  try {
    const result =
      await callPlantGuideApi(
        "recordPlantView",
        {
          sessionToken:
            currentStudentToken,

          plantId:
            plant.id
        }
      );

    if (!result.success) {
      throw new Error(
        result.message ||
        "열람 기록을 저장하지 못했습니다."
      );
    }
  } catch (error) {
    console.error(
      "열람 기록 저장 실패:",
      error
    );
  }
}

// 교사 대시보드 실제 자료
let teacherDashboardData = {
  students: [],
  submissions: [],
  views: []
};

const totalStudentCount =
  document.getElementById(
    "totalStudentCount"
  );

const submittedStudentCount =
  document.getElementById(
    "submittedStudentCount"
  );

const totalPlantCount =
  document.getElementById(
    "totalPlantCount"
  );

const incompleteRecordCount =
  document.getElementById(
    "incompleteRecordCount"
  );

const teacherRecordsTableBody =
  document.getElementById(
    "teacherRecordsTableBody"
  );

const teacherStudentsTableBody =
  document.getElementById(
    "teacherStudentsTableBody"
  );

const teacherViewsTableBody =
  document.getElementById(
    "teacherViewsTableBody"
  );

// 교사 대시보드 불러오기
async function loadTeacherDashboard() {
  if (!currentTeacherToken) {
    return false;
  }

  try {
    const result =
      await callPlantGuideApi(
        "getTeacherDashboard",
        {
          teacherSessionToken:
            currentTeacherToken
        }
      );

    if (!result.success) {
      throw new Error(
        result.message ||
        "대시보드 자료를 불러오지 못했습니다."
      );
    }

    teacherDashboardData = {
      students:
        Array.isArray(result.students)
          ? result.students
          : [],

      submissions:
        Array.isArray(result.submissions)
          ? result.submissions
          : [],

      views:
        Array.isArray(result.views)
          ? result.views
          : []
    };

    renderTeacherSummary(
      result.summary || {}
    );

    renderTeacherStudents(
      teacherDashboardData.students
    );

    renderTeacherSubmissions(
      teacherDashboardData.submissions
    );

    renderTeacherViews(
      teacherDashboardData.views
    );

    return true;
  } catch (error) {
    console.error(error);

    window.alert(
      "교사 대시보드 자료를 불러오지 못했습니다."
    );

    return false;
  }
}

// 요약 현황 표시
function renderTeacherSummary(summary) {
  totalStudentCount.textContent =
    Number(
      summary.totalStudentCount
    ) || 0;

  submittedStudentCount.textContent =
    Number(
      summary.submittedStudentCount
    ) || 0;

  totalPlantCount.textContent =
    Number(
      summary.totalPlantCount
    ) || 0;

  incompleteRecordCount.textContent =
    Number(
      summary.incompleteRecordCount
    ) || 0;
}

// 학생 제출 기록 표시
function renderTeacherSubmissions(
  submissions
) {
  if (submissions.length === 0) {
    teacherRecordsTableBody.innerHTML = `
      <tr class="empty-table-row">
        <td colspan="6">
          아직 제출한 학생이 없습니다.
        </td>
      </tr>
    `;

    return;
  }

  teacherRecordsTableBody.innerHTML =
    submissions.map(function (item) {
      const completed =
        item.status === "completed";

      return `
        <tr>
          <td>
            ${escapeRecordText(
              item.studentNumber
            )}
          </td>

          <td>
            ${escapeRecordText(
              item.studentName
            )}
          </td>

          <td>
            ${item.completedPlantCount} / 5종
            · 사진 ${item.photoCount} / 15
          </td>

          <td>
            ${formatDashboardDate(
              item.updatedAt
            )}
          </td>

          <td>
            <span
              class="my-record-status
              ${completed ? "completed" : ""}"
            >
              ${completed
                ? "작성 완료"
                : "작성 중"}
            </span>
          </td>

          <td>
            <button
              class="record-edit-button"
              type="button"
              data-teacher-submission="${item.studentNumber}"
            >
              상세보기
            </button>
          </td>
        </tr>
      `;
    }).join("");
}

// 학생명단 표시
function renderTeacherStudents(students) {
  if (students.length === 0) {
    teacherStudentsTableBody.innerHTML = `
      <tr class="empty-table-row">
        <td colspan="5">
          등록된 학생이 없습니다.
        </td>
      </tr>
    `;

    return;
  }

  teacherStudentsTableBody.innerHTML =
    students.map(function (student) {
      return `
        <tr>
          <td>
            ${escapeRecordText(
              student.studentNumber
            )}
          </td>

          <td>
            ${escapeRecordText(
              student.studentName
            )}
          </td>

          <td>
            ${formatDashboardDate(
              student.createdAt
            )}
          </td>

          <td>
            ${escapeRecordText(
              student.status
            )}
          </td>

          <td>
            <div class="table-action-group">
              <button
                class="record-edit-button
                ${student.status === "사용"
                  ? "danger-button"
                  : ""}"
                type="button"
                data-toggle-student="${student.studentNumber}"
                data-current-status="${student.status}"
                data-student-name="${escapeRecordText(
                  student.studentName
                 )}"
              >
                ${student.status === "사용"
                  ? "사용 중지"
                  : "사용 재개"}
              </button>

              <button
                class="record-edit-button danger-button"
                type="button"
                data-delete-student="${student.studentNumber}"
                data-student-name="${escapeRecordText(
                  student.studentName
                )}"
              >
                학생 삭제
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
}

// 열람기록 표시
function renderTeacherViews(views) {
  if (views.length === 0) {
    teacherViewsTableBody.innerHTML = `
      <tr class="empty-table-row">
        <td colspan="4">
          아직 열람 기록이 없습니다.
        </td>
      </tr>
    `;

    return;
  }

  teacherViewsTableBody.innerHTML =
    views.map(function (item) {
      return `
        <tr>
          <td>
            ${formatDashboardDate(
              item.viewedAt
            )}
          </td>

          <td>
            ${escapeRecordText(
              item.viewerStudentNumber
            )}
            ${escapeRecordText(
              item.viewerStudentName
            )}
          </td>

          <td>
            ${escapeRecordText(
              item.targetStudentNumber
            )}
            ${escapeRecordText(
              item.targetStudentName
            )}
          </td>

          <td>
            ${escapeRecordText(
              item.koreanName
            )}
          </td>
        </tr>
      `;
    }).join("");
}

// 대시보드 날짜 표시
function formatDashboardDate(value) {
  if (!value) {
    return "-";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return value;
  }

  return date.toLocaleString(
    "ko-KR",
    {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}

// 교사 학생명단 관리
teacherStudentsTableBody.addEventListener(
  "click",
  async function (event) {
    const deleteButton =
      event.target.closest(
        "[data-delete-student]"
      );

    const statusButton =
      event.target.closest(
        "[data-toggle-student]"
      );

    if (deleteButton) {
      const studentNumber =
        deleteButton.dataset
          .deleteStudent;

      const studentName =
        deleteButton.dataset
          .studentName;

      const confirmed =
        window.confirm(
          `${studentNumber} ${studentName} 학생을 삭제하시겠습니까?\n\n작성 내용과 업로드한 사진도 모두 삭제되며 복구할 수 없습니다.`
        );

      if (!confirmed) {
        return;
      }

      await runTeacherStudentAction(
        "deleteStudent",
        {
          studentNumber:
            studentNumber
        }
      );

      return;
    }

    if (statusButton) {
      const studentNumber =
        statusButton.dataset
          .toggleStudent;

      const studentName =
        statusButton.dataset
          .studentName;

      const currentStatus =
        statusButton.dataset
          .currentStatus;

      const newStatus =
        currentStatus === "사용"
          ? "중지"
          : "사용";

      const confirmed =
        window.confirm(
          `${studentNumber} ${studentName} 학생의 계정을 ${newStatus} 상태로 변경하시겠습니까?`
        );

      if (!confirmed) {
        return;
      }

      await runTeacherStudentAction(
        "setStudentStatus",
        {
          studentNumber:
            studentNumber,
          status:
            newStatus
        }
      );
    }
  }
);

// 교사 학생 관리 API 실행
async function runTeacherStudentAction(
  action,
  data
) {
  try {
    const result =
      await callPlantGuideApi(
        action,
        {
          teacherSessionToken:
            currentTeacherToken,
          ...data
        }
      );

    if (!result.success) {
      throw new Error(
        result.message ||
        "학생 정보를 변경하지 못했습니다."
      );
    }

    window.alert(result.message);

    await loadTeacherDashboard();
  } catch (error) {
    console.error(error);

    window.alert(
      error.message ||
      "학생 관리 중 오류가 발생했습니다."
    );
  }
}

// 교사용 제출 상세 화면
const teacherSubmissionModal =
  document.getElementById(
    "teacherSubmissionModal"
  );

const teacherSubmissionOverlay =
  document.getElementById(
    "teacherSubmissionOverlay"
  );

const teacherSubmissionCloseButton =
  document.getElementById(
    "teacherSubmissionCloseButton"
  );

const teacherSubmissionStatus =
  document.getElementById(
    "teacherSubmissionStatus"
  );

const teacherSubmissionTitle =
  document.getElementById(
    "teacherSubmissionTitle"
  );

const teacherSubmissionMeta =
  document.getElementById(
    "teacherSubmissionMeta"
  );

const teacherSubmissionPlantTabs =
  document.getElementById(
    "teacherSubmissionPlantTabs"
  );

const teacherSubmissionPlantContent =
  document.getElementById(
    "teacherSubmissionPlantContent"
  );

const teacherSubmissionSelectionReason =
  document.getElementById(
    "teacherSubmissionSelectionReason"
  );

const teacherSubmissionInquiryPlant =
  document.getElementById(
    "teacherSubmissionInquiryPlant"
  );

const teacherSubmissionInquiryTopic =
  document.getElementById(
    "teacherSubmissionInquiryTopic"
  );

const teacherSubmissionReflection =
  document.getElementById(
    "teacherSubmissionReflection"
  );

const teacherVisibilityDescription =
  document.getElementById(
    "teacherVisibilityDescription"
  );

const teacherVisibilityButton =
  document.getElementById(
    "teacherVisibilityButton"
  );

let currentTeacherSubmission = null;

// 제출 기록의 상세보기 버튼
teacherRecordsTableBody.addEventListener(
  "click",
  function (event) {
    const detailButton =
      event.target.closest(
        "[data-teacher-submission]"
      );

    if (!detailButton) {
      return;
    }

    openTeacherSubmission(
      detailButton.dataset
        .teacherSubmission
    );
  }
);

// 학생 제출 상세 자료 불러오기
async function openTeacherSubmission(
  studentNumber
) {
  if (!currentTeacherToken) {
    return;
  }

  teacherSubmissionModal.classList.remove(
    "hidden"
  );

  document.body.classList.add(
    "modal-open"
  );

  teacherSubmissionTitle.textContent =
    "제출 기록을 불러오는 중...";

  teacherSubmissionPlantTabs.innerHTML =
    "";

  teacherSubmissionPlantContent.innerHTML = `
    <div class="guide-empty-state">
      <span>⏳</span>
      <strong>학생 기록을 불러오는 중입니다.</strong>
    </div>
  `;

  try {
    const result =
      await callPlantGuideApi(
        "getTeacherSubmission",
        {
          teacherSessionToken:
            currentTeacherToken,

          studentNumber:
            studentNumber
        }
      );

    if (!result.success) {
      throw new Error(
        result.message ||
        "학생 제출 자료를 불러오지 못했습니다."
      );
    }

    currentTeacherSubmission =
      result;

    renderTeacherSubmissionDetail();
  } catch (error) {
    console.error(error);

    teacherSubmissionTitle.textContent =
      "자료 불러오기 실패";

    teacherSubmissionPlantContent.innerHTML = `
      <div class="guide-empty-state">
        <span>⚠️</span>
        <strong>
          학생 제출 자료를 불러오지 못했습니다.
        </strong>
        <p>${escapeRecordText(
          error.message
        )}</p>
      </div>
    `;
  }
}

// 교사용 상세 화면 전체 표시
function renderTeacherSubmissionDetail() {
  const data =
    currentTeacherSubmission;

  const student =
    data.student;

  const submission =
    data.submission;

  const visibility =
    submission.visibility || "공개";

  teacherSubmissionStatus.textContent =
    visibility;

  teacherSubmissionStatus.classList.toggle(
    "incomplete",
    visibility === "숨김"
  );

  teacherSubmissionTitle.textContent =
    `${student.studentNumber} ${student.studentName}`;

  teacherSubmissionMeta.textContent =
    "최근 제출: " +
    formatDashboardDate(
      submission.updatedAt
    );

  teacherSubmissionSelectionReason.textContent =
    submission.selectionReason ||
    "아직 작성되지 않았습니다.";

  teacherSubmissionInquiryPlant.textContent =
    submission.inquiryPlant ||
    "아직 작성되지 않았습니다.";

  teacherSubmissionInquiryTopic.textContent =
    submission.inquiryTopic ||
    "아직 작성되지 않았습니다.";

  teacherSubmissionReflection.textContent =
    submission.reflection ||
    "아직 작성되지 않았습니다.";

  teacherVisibilityDescription.textContent =
    visibility === "공개"
      ? "현재 모든 학생의 공동 도감에 공개되고 있습니다."
      : "현재 공동 도감에서 숨겨진 상태입니다.";

  teacherVisibilityButton.textContent =
    visibility === "공개"
      ? "공동 도감에서 숨기기"
      : "공동 도감에 다시 공개";

  teacherVisibilityButton.dataset.visibility =
    visibility;

  teacherSubmissionPlantTabs.innerHTML =
    "";

  for (
    let index = 1;
    index <= 5;
    index += 1
  ) {
    const plant =
      data.plants.find(
        function (item) {
          return (
            Number(item.speciesNumber) ===
            index
          );
        }
      );

    const tab =
      document.createElement("button");

    tab.type = "button";
    tab.className =
      "teacher-plant-tab";

    tab.textContent =
      plant && plant.koreanName
        ? `${index}. ${plant.koreanName}`
        : `식물 ${index}`;

    tab.addEventListener(
      "click",
      function () {
        showTeacherPlantDetail(index);
      }
    );

    teacherSubmissionPlantTabs.appendChild(
      tab
    );
  }

  showTeacherPlantDetail(1);
}

// 선택한 식물 상세 표시
function showTeacherPlantDetail(
  speciesNumber
) {
  const data =
    currentTeacherSubmission;

  const plant =
    data.plants.find(
      function (item) {
        return (
          Number(item.speciesNumber) ===
          Number(speciesNumber)
        );
      }
    ) || {
      speciesNumber:
        speciesNumber,
      koreanName: "",
      scientificName: "",
      discoveryDate: "",
      discoveryPlace: "",
      habitat: "",
      features: "",
      references: "",
      status: "작성중"
    };

  const tabs =
    teacherSubmissionPlantTabs
      .querySelectorAll(
        ".teacher-plant-tab"
      );

  tabs.forEach(function (tab, index) {
    tab.classList.toggle(
      "active",
      index + 1 ===
        Number(speciesNumber)
    );
  });

  const photos = {
    Leaf:
      findTeacherSubmissionPhoto(
        speciesNumber,
        "Leaf"
      ),

    Stem:
      findTeacherSubmissionPhoto(
        speciesNumber,
        "Stem"
      ),

    Whole:
      findTeacherSubmissionPhoto(
        speciesNumber,
        "Whole"
      )
  };

  const completed =
    plant.status === "완료" &&
    photos.Leaf &&
    photos.Stem &&
    photos.Whole;

  teacherSubmissionPlantContent.innerHTML = `
    <div class="teacher-plant-heading">
      <div>
        <h3>
          ${escapeRecordText(
            plant.koreanName ||
            "아직 작성되지 않은 식물"
          )}
        </h3>

        <p>
          ${escapeRecordText(
            plant.scientificName ||
            "학명 미작성"
          )}
        </p>
      </div>

      <span
        class="plant-status-badge
        ${completed ? "" : "incomplete"}"
      >
        ${completed ? "작성 완료" : "작성 중"}
      </span>
    </div>

    <div class="teacher-detail-photos">
      ${createTeacherDetailPhoto(
        photos.Leaf,
        "잎 사진",
        "🍃"
      )}

      ${createTeacherDetailPhoto(
        photos.Stem,
        "줄기 사진",
        "🌱"
      )}

      ${createTeacherDetailPhoto(
        photos.Whole,
        "식물 전체 사진",
        "🌿"
      )}
    </div>

    <div class="teacher-detail-info-grid">
      ${createTeacherDetailInfo(
        "발견 날짜",
        plant.discoveryDate || "미작성"
      )}

      ${createTeacherDetailInfo(
        "발견 장소",
        plant.discoveryPlace || "미작성"
      )}

      ${createTeacherDetailInfo(
        "서식 환경",
        plant.habitat || "미작성",
        true
      )}

      ${createTeacherDetailInfo(
        "식물 특징",
        plant.features || "미작성",
        true
      )}

      ${createTeacherDetailInfo(
        "참고자료 및 출처",
        plant.references || "미작성",
        true
      )}
    </div>
  `;
}

// 교사용 사진 찾기
function findTeacherSubmissionPhoto(
  speciesNumber,
  photoType
) {
  return currentTeacherSubmission.photos.find(
    function (photo) {
      return (
        Number(photo.speciesNumber) ===
          Number(speciesNumber) &&
        photo.photoType === photoType
      );
    }
  ) || null;
}

// 교사용 사진 HTML
function createTeacherDetailPhoto(
  photo,
  label,
  icon
) {
  const safePhotoUrl =
    getSafePhotoUrl(
      photo && photo.photoUrl
        ? photo.photoUrl
        : ""
    );

  const safeLabel =
    escapeRecordText(label);

  const safeIcon =
    escapeRecordText(icon);

  const content =
    safePhotoUrl
      ? `
        <img
          src="${safePhotoUrl}"
          alt="${safeLabel}"
          loading="lazy"
          referrerpolicy="no-referrer"
        >
      `
      : `
        <div class="teacher-detail-photo-placeholder">
          ${safeIcon}
        </div>
      `;

  return `
    <div class="teacher-detail-photo">
      ${content}
      <p>${safeLabel}</p>
    </div>
  `;
}

// 교사용 상세 정보 HTML
function createTeacherDetailInfo(
  title,
  content,
  fullWidth = false
) {
  return `
    <article
      class="teacher-detail-info
      ${fullWidth ? "full-width" : ""}"
    >
      <strong>${title}</strong>
      <p>${escapeRecordText(content)}</p>
    </article>
  `;
}

// 공개 또는 숨김 변경
teacherVisibilityButton.addEventListener(
  "click",
  async function () {
    if (!currentTeacherSubmission) {
      return;
    }

    const currentVisibility =
      teacherVisibilityButton.dataset
        .visibility;

    const newVisibility =
      currentVisibility === "공개"
        ? "숨김"
        : "공개";

    let reason = "";

    if (newVisibility === "숨김") {
      reason = window.prompt(
        "공동 도감에서 숨기는 사유를 입력해주세요."
      );

      if (reason === null) {
        return;
      }

      reason = reason.trim();

      if (!reason) {
        window.alert(
          "숨김 사유를 입력해야 합니다."
        );

        return;
      }
    } else {
      const confirmed =
        window.confirm(
          "이 학생의 제출물을 공동 도감에 다시 공개하시겠습니까?"
        );

      if (!confirmed) {
        return;
      }
    }

    teacherVisibilityButton.disabled =
      true;

    try {
      const result =
        await callPlantGuideApi(
          "setSubmissionVisibility",
          {
            teacherSessionToken:
              currentTeacherToken,

            studentNumber:
              currentTeacherSubmission
                .student.studentNumber,

            visibility:
              newVisibility,

            reason:
              reason
          }
        );

      if (!result.success) {
        throw new Error(
          result.message ||
          "공개 상태를 변경하지 못했습니다."
        );
      }

      window.alert(result.message);

      currentTeacherSubmission
        .submission.visibility =
        newVisibility;

      renderTeacherSubmissionDetail();

      await loadTeacherDashboard();
    } catch (error) {
      console.error(error);

      window.alert(
        error.message ||
        "공개 상태 변경 중 오류가 발생했습니다."
      );
    } finally {
      teacherVisibilityButton.disabled =
        false;
    }
  }
);

// 교사용 상세 창 닫기
function closeTeacherSubmissionModal() {
  teacherSubmissionModal.classList.add(
    "hidden"
  );

  currentTeacherSubmission = null;

  document.body.classList.remove(
    "modal-open"
  );
}

teacherSubmissionCloseButton.addEventListener(
  "click",
  closeTeacherSubmissionModal
);

teacherSubmissionOverlay.addEventListener(
  "click",
  closeTeacherSubmissionModal
);
