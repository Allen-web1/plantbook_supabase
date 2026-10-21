import { createClient } from "npm:@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BUCKET = "plant-photos";
const STUDENT_SESSION_HOURS = 24;
const TEACHER_SESSION_HOURS = 8;

function readKeySet(environmentName: string, legacyName: string): string[] {
  const raw = Deno.env.get(environmentName);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return Object.values(parsed).filter(Boolean);
    } catch {
      // 아래의 레거시 키로 대체합니다.
    }
  }

  const legacy = Deno.env.get(legacyName);
  return legacy ? [legacy] : [];
}

const publishableKeys = readKeySet(
  "SUPABASE_PUBLISHABLE_KEYS",
  "SUPABASE_ANON_KEY"
);
const secretKeys = readKeySet(
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_SERVICE_ROLE_KEY"
);
const secretKey = secretKeys[0] ?? "";

const supabase = createClient(SUPABASE_URL, secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};

function json(data: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeName(value: unknown): string {
  return text(value).replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

function isPlantTextComplete(plant: JsonRecord): boolean {
  return Boolean(
    text(plant.korean_name ?? plant.koreanName) &&
    text(plant.scientific_name ?? plant.scientificName) &&
    text(plant.discovery_date ?? plant.discoveryDate) &&
    text(plant.discovery_place ?? plant.discoveryPlace) &&
    text(plant.habitat) &&
    text(plant.features)
  );
}

function hasAnyPlantText(plant: JsonRecord): boolean {
  return Boolean(
    text(plant.korean_name) ||
    text(plant.scientific_name) ||
    text(plant.discovery_date) ||
    text(plant.discovery_place) ||
    text(plant.habitat) ||
    text(plant.features)
  );
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = leftHash.length ^ rightHash.length;

  for (let index = 0; index < Math.max(leftHash.length, rightHash.length); index += 1) {
    difference |= (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0);
  }

  return difference === 0;
}

function expiryAfterHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function requireStudent(sessionToken: unknown) {
  const rawToken = text(sessionToken);
  if (!rawToken) {
    throw new Error("학생 로그인 정보가 없습니다.");
  }

  const tokenHash = await sha256(rawToken);
  const { data: session, error: sessionError } = await supabase
    .from("student_sessions")
    .select("id, student_id, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (sessionError) throw sessionError;
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session?.id) {
      await supabase.from("student_sessions").delete().eq("id", session.id);
    }
    throw new Error("로그인 시간이 만료되었습니다. 다시 로그인해주세요.");
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("*")
    .eq("id", session.student_id)
    .single();

  if (studentError) throw studentError;
  if (student.status !== "active") {
    throw new Error("현재 사용할 수 없는 계정입니다. 담당 선생님께 문의해주세요.");
  }

  return student;
}

async function requireTeacher(teacherSessionToken: unknown) {
  const rawToken = text(teacherSessionToken);
  if (!rawToken) {
    throw new Error("교사 로그인 정보가 없습니다.");
  }

  const tokenHash = await sha256(rawToken);
  const { data: session, error } = await supabase
    .from("teacher_sessions")
    .select("id, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) throw error;
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session?.id) {
      await supabase.from("teacher_sessions").delete().eq("id", session.id);
    }
    throw new Error("교사 로그인 시간이 만료되었습니다. 다시 로그인해주세요.");
  }

  return session;
}

async function createPhotoDto(photo: JsonRecord) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(String(photo.storage_path), 60 * 60);

  if (error) throw error;

  return {
    id: photo.id,
    speciesNumber: Number(photo.species_number),
    photoType: String(photo.photo_type),
    photoUrl: data.signedUrl,
    mimeType: String(photo.mime_type || "image/jpeg"),
    updatedAt: photo.updated_at
  };
}

async function createPhotoDtos(photos: JsonRecord[]) {
  const result: JsonRecord[] = [];
  const chunkSize = 100;

  for (let start = 0; start < photos.length; start += chunkSize) {
    const chunk = photos.slice(start, start + chunkSize);
    const paths = chunk.map((photo) => String(photo.storage_path));
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, 60 * 60);
    if (error) throw error;

    chunk.forEach((photo, index) => {
      result.push({
        id: photo.id,
        speciesNumber: Number(photo.species_number),
        photoType: String(photo.photo_type),
        photoUrl: data?.[index]?.signedUrl ?? "",
        mimeType: String(photo.mime_type || "image/jpeg"),
        updatedAt: photo.updated_at
      });
    });
  }

  return result;
}

async function fetchAllRows(
  table: string,
  columns = "*",
  configure?: (query: any) => any
): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  const pageSize = 1000;

  for (let start = 0; ; start += pageSize) {
    let query: any = supabase
      .from(table)
      .select(columns)
      .range(start, start + pageSize - 1);

    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) throw error;

    const page = (data ?? []) as JsonRecord[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function recalculateStudentStatus(studentId: string) {
  const [{ data: plants, error: plantsError }, { data: photos, error: photosError }] =
    await Promise.all([
      supabase.from("plants").select("*").eq("student_id", studentId),
      supabase.from("photos").select("species_number, photo_type").eq("student_id", studentId)
    ]);

  if (plantsError) throw plantsError;
  if (photosError) throw photosError;

  const photoTypesBySpecies = new Map<number, Set<string>>();
  for (const photo of photos ?? []) {
    const speciesNumber = Number(photo.species_number);
    if (!photoTypesBySpecies.has(speciesNumber)) {
      photoTypesBySpecies.set(speciesNumber, new Set());
    }
    photoTypesBySpecies.get(speciesNumber)?.add(String(photo.photo_type));
  }

  let completedPlantCount = 0;
  for (const plant of plants ?? []) {
    const photosForPlant = photoTypesBySpecies.get(Number(plant.species_number));
    const completed = isPlantTextComplete(plant) && photosForPlant?.size === 3;
    if (completed) completedPlantCount += 1;

    if (plant.status !== (completed ? "completed" : "incomplete")) {
      const { error } = await supabase
        .from("plants")
        .update({ status: completed ? "completed" : "incomplete" })
        .eq("id", plant.id);
      if (error) throw error;
    }
  }

  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("id, references_text, reflection, status")
    .eq("student_id", studentId)
    .maybeSingle();

  if (submissionError) throw submissionError;
  if (!submission) return { completedPlantCount, status: "incomplete" };

  const completed =
    completedPlantCount === 5 &&
    Boolean(text(submission.references_text)) &&
    Boolean(text(submission.reflection));
  const status = completed ? "completed" : "incomplete";

  if (submission.status !== status) {
    const { error } = await supabase
      .from("submissions")
      .update({ status })
      .eq("id", submission.id);
    if (error) throw error;
  }

  return { completedPlantCount, status };
}

async function handleStudentLogin(body: JsonRecord) {
  const studentNumber = text(body.studentNumber);
  const studentName = text(body.studentName).replace(/\s+/g, " ");
  const normalizedName = normalizeName(studentName);

  if (!studentNumber || !studentName) {
    return json({ success: false, message: "학번과 이름을 모두 입력해주세요." });
  }

  if (!/^\d{1,20}$/.test(studentNumber)) {
    return json({ success: false, message: "학번은 숫자만 입력해주세요." });
  }

  let { data: student, error } = await supabase
    .from("students")
    .select("*")
    .eq("student_number", studentNumber)
    .maybeSingle();

  if (error) throw error;

  if (!student) {
    const inserted = await supabase
      .from("students")
      .insert({
        student_number: studentNumber,
        student_name: studentName,
        normalized_name: normalizedName
      })
      .select("*")
      .maybeSingle();

    if (inserted.error) {
      const existing = await supabase
        .from("students")
        .select("*")
        .eq("student_number", studentNumber)
        .maybeSingle();
      if (existing.error) throw existing.error;
      student = existing.data;
    } else {
      student = inserted.data;
    }
  }

  if (!student || student.normalized_name !== normalizedName) {
    return json({
      success: false,
      message: "이미 등록된 학번입니다. 처음 등록한 이름을 정확히 입력해주세요."
    });
  }

  if (student.status !== "active") {
    return json({
      success: false,
      message: "현재 사용할 수 없는 계정입니다. 담당 선생님께 문의해주세요."
    });
  }

  const sessionToken = randomToken();
  const { error: sessionError } = await supabase.from("student_sessions").insert({
    student_id: student.id,
    token_hash: await sha256(sessionToken),
    expires_at: expiryAfterHours(STUDENT_SESSION_HOURS)
  });
  if (sessionError) throw sessionError;

  return json({
    success: true,
    message: "로그인되었습니다.",
    sessionToken,
    student: {
      studentNumber: student.student_number,
      studentName: student.student_name,
      mustChangePassword: false
    }
  });
}

async function handleStudentLogout(body: JsonRecord) {
  const token = text(body.sessionToken);
  if (token) {
    await supabase.from("student_sessions").delete().eq("token_hash", await sha256(token));
  }
  return json({ success: true, message: "로그아웃되었습니다." });
}

async function handleSaveSubmission(body: JsonRecord) {
  const student = await requireStudent(body.sessionToken);
  const plants = Array.isArray(body.plants) ? body.plants as JsonRecord[] : [];
  const referencesText = text(body.references);
  const reflection = text(body.reflection);

  const { error: submissionError } = await supabase.from("submissions").upsert({
    student_id: student.id,
    references_text: referencesText,
    reflection,
    updated_at: new Date().toISOString()
  }, { onConflict: "student_id" });
  if (submissionError) throw submissionError;

  const plantRows = Array.from({ length: 5 }, (_, index) => {
    const speciesNumber = index + 1;
    const input = plants.find((item) => Number(item.speciesNumber) === speciesNumber) ?? {};
    return {
      student_id: student.id,
      species_number: speciesNumber,
      korean_name: text(input.koreanName),
      scientific_name: text(input.scientificName),
      discovery_date: text(input.discoveryDate) || null,
      discovery_place: text(input.discoveryPlace),
      habitat: text(input.habitat),
      features: text(input.features),
      status: "incomplete",
      updated_at: new Date().toISOString()
    };
  });

  const { error: plantsError } = await supabase
    .from("plants")
    .upsert(plantRows, { onConflict: "student_id,species_number" });
  if (plantsError) throw plantsError;

  const status = await recalculateStudentStatus(student.id);

  return json({
    success: true,
    message: "현재 작성 내용이 저장되었습니다.",
    savedAt: new Date().toISOString(),
    completedPlantCount: status.completedPlantCount,
    status: status.status
  });
}

async function handleUploadPhoto(body: JsonRecord) {
  const student = await requireStudent(body.sessionToken);
  const speciesNumber = Number(body.speciesNumber);
  const photoType = text(body.photoType);
  const mimeType = text(body.mimeType) || "image/jpeg";
  const base64Data = text(body.base64Data);

  if (!Number.isInteger(speciesNumber) || speciesNumber < 1 || speciesNumber > 5) {
    return json({ success: false, message: "식물 번호가 올바르지 않습니다." });
  }
  if (!["Leaf", "Stem", "Whole"].includes(photoType)) {
    return json({ success: false, message: "사진 종류가 올바르지 않습니다." });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    return json({ success: false, message: "지원하지 않는 사진 형식입니다." });
  }

  const encoded = base64Data.includes(",") ? base64Data.split(",").pop() ?? "" : base64Data;
  if (!encoded) {
    return json({ success: false, message: "사진 데이터가 없습니다." });
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(encoded);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return json({ success: false, message: "사진 데이터를 읽을 수 없습니다." });
  }

  if (bytes.byteLength > 5 * 1024 * 1024) {
    return json({ success: false, message: "압축된 사진은 5MB 이하여야 합니다." });
  }

  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const storagePath = `${student.id}/${speciesNumber}/${photoType.toLowerCase()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      cacheControl: "3600",
      upsert: true
    });
  if (uploadError) throw uploadError;

  const { data: photo, error: photoError } = await supabase
    .from("photos")
    .upsert({
      student_id: student.id,
      species_number: speciesNumber,
      photo_type: photoType,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      updated_at: new Date().toISOString()
    }, { onConflict: "student_id,species_number,photo_type" })
    .select("*")
    .single();
  if (photoError) throw photoError;

  await recalculateStudentStatus(student.id);
  return json({ success: true, message: "사진이 저장되었습니다.", photo: await createPhotoDto(photo) });
}

async function handleLoadMySubmission(body: JsonRecord) {
  const student = await requireStudent(body.sessionToken);
  const [submissionResult, plantsResult, photosResult] = await Promise.all([
    supabase.from("submissions").select("*").eq("student_id", student.id).maybeSingle(),
    supabase.from("plants").select("*").eq("student_id", student.id).order("species_number"),
    supabase.from("photos").select("*").eq("student_id", student.id).order("species_number")
  ]);

  if (submissionResult.error) throw submissionResult.error;
  if (plantsResult.error) throw plantsResult.error;
  if (photosResult.error) throw photosResult.error;

  const submission = submissionResult.data;
  const plants = plantsResult.data ?? [];
  const photos = photosResult.data ?? [];

  return json({
    success: true,
    hasSubmission: Boolean(submission || plants.length || photos.length),
    submission: {
      references: submission?.references_text ?? "",
      reflection: submission?.reflection ?? "",
      visibility: submission?.visibility === "hidden" ? "숨김" : "공개",
      updatedAt: submission?.updated_at ?? null
    },
    plants: plants.map((plant) => ({
      id: plant.id,
      speciesNumber: plant.species_number,
      koreanName: plant.korean_name,
      scientificName: plant.scientific_name,
      discoveryDate: plant.discovery_date,
      discoveryPlace: plant.discovery_place,
      habitat: plant.habitat,
      features: plant.features,
      status: plant.status === "completed" ? "완료" : "작성중"
    })),
    photos: await createPhotoDtos(photos)
  });
}

async function handleGetSharedPlants(body: JsonRecord) {
  await requireStudent(body.sessionToken);
  const { data: submissions, error: submissionsError } = await supabase
    .from("submissions")
    .select("student_id, references_text")
    .eq("visibility", "public");
  if (submissionsError) throw submissionsError;

  const studentIds = (submissions ?? []).map((item) => item.student_id);
  if (studentIds.length === 0) {
    return json({ success: true, plants: [] });
  }

  const [plantRows, photoRows] = await Promise.all([
    fetchAllRows("plants", "*", (query) =>
      query.in("student_id", studentIds).order("updated_at", { ascending: false })
    ),
    fetchAllRows("photos", "*", (query) => query.in("student_id", studentIds))
  ]);

  const referenceByStudent = new Map(
    (submissions ?? []).map((item) => [item.student_id, item.references_text])
  );
  const photoDtos = await createPhotoDtos(photoRows);
  const photosByPlant = new Map<string, Record<string, unknown>>();

  for (const photo of photoDtos) {
    const source = photoRows.find((item) => item.id === photo.id);
    if (!source) continue;
    const key = `${source.student_id}-${source.species_number}`;
    if (!photosByPlant.has(key)) photosByPlant.set(key, {});
    photosByPlant.get(key)![String(source.photo_type)] = photo;
  }

  const plants = plantRows
    .filter((plant) => hasAnyPlantText(plant))
    .map((plant) => ({
      id: plant.id,
      speciesNumber: plant.species_number,
      koreanName: plant.korean_name,
      scientificName: plant.scientific_name,
      discoveryDate: plant.discovery_date ?? "",
      discoveryPlace: plant.discovery_place,
      habitat: plant.habitat,
      features: plant.features,
      status: plant.status,
      references: referenceByStudent.get(plant.student_id) ?? "",
      photos: photosByPlant.get(`${plant.student_id}-${plant.species_number}`) ?? {}
    }));

  return json({ success: true, plants });
}

async function handleRecordPlantView(body: JsonRecord) {
  const viewer = await requireStudent(body.sessionToken);
  const plantId = text(body.plantId);
  const { data: plant, error } = await supabase
    .from("plants")
    .select("id, student_id")
    .eq("id", plantId)
    .maybeSingle();
  if (error) throw error;

  if (plant) {
    const { error: insertError } = await supabase.from("plant_views").insert({
      viewer_student_id: viewer.id,
      target_student_id: plant.student_id,
      plant_id: plant.id
    });
    if (insertError) throw insertError;
  }

  return json({ success: true });
}

async function handleTeacherLogin(body: JsonRecord) {
  const expectedPassword = Deno.env.get("TEACHER_PASSWORD") ?? "";
  if (!expectedPassword) {
    return json({
      success: false,
      message: "Edge Function Secrets에 TEACHER_PASSWORD를 먼저 설정해주세요."
    });
  }

  const { data: state, error: stateError } = await supabase
    .from("teacher_login_state")
    .select("*")
    .eq("id", true)
    .single();
  if (stateError) throw stateError;

  if (state.locked_until && new Date(state.locked_until).getTime() > Date.now()) {
    return json({
      success: false,
      message: "교사 로그인에 5회 실패했습니다. 3분 후 다시 시도해주세요."
    });
  }

  const matches = await secureEqual(text(body.teacherPassword), expectedPassword);
  if (!matches) {
    const nextCount = Number(state.failure_count || 0) + 1;
    const locked = nextCount >= 5;
    const { error } = await supabase.from("teacher_login_state").update({
      failure_count: locked ? 0 : nextCount,
      locked_until: locked ? new Date(Date.now() + 3 * 60 * 1000).toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("id", true);
    if (error) throw error;

    return json({
      success: false,
      message: locked
        ? "교사 로그인에 5회 실패했습니다. 3분 후 다시 시도해주세요."
        : "교사 비밀번호가 일치하지 않습니다."
    });
  }

  await supabase.from("teacher_login_state").update({
    failure_count: 0,
    locked_until: null,
    updated_at: new Date().toISOString()
  }).eq("id", true);

  const teacherSessionToken = randomToken();
  const { error } = await supabase.from("teacher_sessions").insert({
    token_hash: await sha256(teacherSessionToken),
    expires_at: expiryAfterHours(TEACHER_SESSION_HOURS)
  });
  if (error) throw error;

  return json({ success: true, message: "교사로 로그인했습니다.", teacherSessionToken });
}

async function handleTeacherLogout(body: JsonRecord) {
  const token = text(body.teacherSessionToken);
  if (token) {
    await supabase.from("teacher_sessions").delete().eq("token_hash", await sha256(token));
  }
  return json({ success: true, message: "로그아웃되었습니다." });
}

async function getAllDashboardData() {
  const [students, submissions, plants, photos, allViews] = await Promise.all([
    fetchAllRows("students", "*", (query) => query.order("student_number")),
    fetchAllRows("submissions"),
    fetchAllRows("plants"),
    fetchAllRows("photos", "id, student_id, species_number, photo_type"),
    fetchAllRows("plant_views", "*", (query) => query.order("viewed_at", { ascending: false }))
  ]);

  return {
    students,
    submissions,
    plants,
    photos,
    views: allViews.slice(0, 2000)
  };
}

async function handleTeacherDashboard(body: JsonRecord) {
  await requireTeacher(body.teacherSessionToken);
  const data = await getAllDashboardData();
  const studentById = new Map(data.students.map((student) => [student.id, student]));
  const plantsByStudent = new Map<string, JsonRecord[]>();
  const photoCountByStudent = new Map<string, number>();

  for (const plant of data.plants) {
    if (!plantsByStudent.has(plant.student_id)) plantsByStudent.set(plant.student_id, []);
    plantsByStudent.get(plant.student_id)?.push(plant);
  }
  for (const photo of data.photos) {
    photoCountByStudent.set(
      photo.student_id,
      (photoCountByStudent.get(photo.student_id) ?? 0) + 1
    );
  }

  const students = data.students.map((student) => ({
    studentNumber: student.student_number,
    studentName: student.student_name,
    status: student.status === "active" ? "사용" : "중지",
    createdAt: student.created_at
  }));

  const submissions = data.submissions.map((submission) => {
    const student = studentById.get(submission.student_id);
    const plants = plantsByStudent.get(submission.student_id) ?? [];
    return {
      studentNumber: student?.student_number ?? "",
      studentName: student?.student_name ?? "",
      completedPlantCount: plants.filter((plant) => plant.status === "completed").length,
      photoCount: photoCountByStudent.get(submission.student_id) ?? 0,
      status: submission.status,
      visibility: submission.visibility === "hidden" ? "숨김" : "공개",
      updatedAt: submission.updated_at,
      plantNames: plants.map((plant) => plant.korean_name).filter(Boolean).join(" ")
    };
  });

  const views = data.views.map((view) => {
    const viewer = studentById.get(view.viewer_student_id);
    const target = studentById.get(view.target_student_id);
    const plant = data.plants.find((item) => item.id === view.plant_id);
    return {
      viewedAt: view.viewed_at,
      viewerStudentNumber: viewer?.student_number ?? "",
      viewerStudentName: viewer?.student_name ?? "",
      targetStudentNumber: target?.student_number ?? "",
      targetStudentName: target?.student_name ?? "",
      koreanName: plant?.korean_name ?? ""
    };
  });

  const completedPlantCount = data.plants.filter((plant) => plant.status === "completed").length;
  return json({
    success: true,
    summary: {
      totalStudentCount: students.length,
      submittedStudentCount: submissions.length,
      totalPlantCount: completedPlantCount,
      incompleteRecordCount: submissions.filter((item) => item.status !== "completed").length
    },
    students,
    submissions,
    views
  });
}

async function handleTeacherSubmission(body: JsonRecord) {
  await requireTeacher(body.teacherSessionToken);
  const studentNumber = text(body.studentNumber);
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("*")
    .eq("student_number", studentNumber)
    .maybeSingle();
  if (studentError) throw studentError;
  if (!student) return json({ success: false, message: "학생을 찾을 수 없습니다." });

  const [submissionResult, plantsResult, photosResult] = await Promise.all([
    supabase.from("submissions").select("*").eq("student_id", student.id).maybeSingle(),
    supabase.from("plants").select("*").eq("student_id", student.id).order("species_number"),
    supabase.from("photos").select("*").eq("student_id", student.id).order("species_number")
  ]);
  if (submissionResult.error) throw submissionResult.error;
  if (plantsResult.error) throw plantsResult.error;
  if (photosResult.error) throw photosResult.error;

  const submission = submissionResult.data;
  return json({
    success: true,
    student: {
      studentNumber: student.student_number,
      studentName: student.student_name
    },
    submission: {
      references: submission?.references_text ?? "",
      reflection: submission?.reflection ?? "",
      visibility: submission?.visibility === "hidden" ? "숨김" : "공개",
      updatedAt: submission?.updated_at ?? null
    },
    plants: (plantsResult.data ?? []).map((plant) => ({
      id: plant.id,
      speciesNumber: plant.species_number,
      koreanName: plant.korean_name,
      scientificName: plant.scientific_name,
      discoveryDate: plant.discovery_date,
      discoveryPlace: plant.discovery_place,
      habitat: plant.habitat,
      features: plant.features,
      status: plant.status === "completed" ? "완료" : "작성중"
    })),
    photos: await createPhotoDtos(photosResult.data ?? [])
  });
}

async function handleSetSubmissionVisibility(body: JsonRecord) {
  await requireTeacher(body.teacherSessionToken);
  const studentNumber = text(body.studentNumber);
  const visibility = text(body.visibility) === "숨김" ? "hidden" : "public";
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id")
    .eq("student_number", studentNumber)
    .maybeSingle();
  if (studentError) throw studentError;
  if (!student) return json({ success: false, message: "학생을 찾을 수 없습니다." });

  const { error } = await supabase.from("submissions").update({
    visibility,
    hidden_reason: visibility === "hidden" ? text(body.reason) : ""
  }).eq("student_id", student.id);
  if (error) throw error;
  return json({ success: true, message: visibility === "hidden" ? "공동 도감에서 숨겼습니다." : "공동 도감에 공개했습니다." });
}

async function handleSetStudentStatus(body: JsonRecord) {
  await requireTeacher(body.teacherSessionToken);
  const studentNumber = text(body.studentNumber);
  const status = text(body.status) === "중지" ? "blocked" : "active";
  const { data: student, error } = await supabase
    .from("students")
    .update({ status })
    .eq("student_number", studentNumber)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!student) return json({ success: false, message: "학생을 찾을 수 없습니다." });
  if (status === "blocked") {
    await supabase.from("student_sessions").delete().eq("student_id", student.id);
  }
  return json({ success: true, message: status === "blocked" ? "학생 사용을 중지했습니다." : "학생 사용을 재개했습니다." });
}

async function handleDeleteStudent(body: JsonRecord) {
  await requireTeacher(body.teacherSessionToken);
  const studentNumber = text(body.studentNumber);
  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, student_name")
    .eq("student_number", studentNumber)
    .maybeSingle();
  if (studentError) throw studentError;
  if (!student) return json({ success: false, message: "학생을 찾을 수 없습니다." });

  const { data: photos, error: photosError } = await supabase
    .from("photos")
    .select("storage_path")
    .eq("student_id", student.id);
  if (photosError) throw photosError;

  const paths = (photos ?? []).map((photo) => photo.storage_path);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    if (storageError) throw storageError;
  }

  const { error: deleteError } = await supabase.from("students").delete().eq("id", student.id);
  if (deleteError) throw deleteError;
  return json({ success: true, message: `${studentNumber} ${student.student_name} 학생과 모든 자료를 삭제했습니다.` });
}

async function handleExportTeacherCsv(body: JsonRecord) {
  await requireTeacher(body.teacherSessionToken);
  const data = await getAllDashboardData();
  const submissionByStudent = new Map(data.submissions.map((item) => [item.student_id, item]));
  const plantsByStudent = new Map<string, JsonRecord[]>();

  for (const plant of data.plants) {
    if (!plantsByStudent.has(plant.student_id)) plantsByStudent.set(plant.student_id, []);
    plantsByStudent.get(plant.student_id)?.push(plant);
  }

  const rows: JsonRecord[] = [];
  for (const student of data.students) {
    const submission = submissionByStudent.get(student.id);
    const plants = (plantsByStudent.get(student.id) ?? []).sort(
      (left, right) => Number(left.species_number) - Number(right.species_number)
    );
    const targets = plants.length ? plants : [{ species_number: "" }];

    for (const plant of targets) {
      rows.push({
        studentNumber: student.student_number,
        studentName: student.student_name,
        speciesNumber: plant.species_number ?? "",
        koreanName: plant.korean_name ?? "",
        scientificName: plant.scientific_name ?? "",
        discoveryDate: plant.discovery_date ?? "",
        discoveryPlace: plant.discovery_place ?? "",
        habitat: plant.habitat ?? "",
        features: plant.features ?? "",
        plantStatus: plant.status === "completed" ? "작성 완료" : "작성 중",
        references: submission?.references_text ?? "",
        reflection: submission?.reflection ?? "",
        submissionStatus: submission?.status === "completed" ? "작성 완료" : "작성 중",
        visibility: submission?.visibility === "hidden" ? "숨김" : "공개",
        updatedAt: submission?.updated_at ?? ""
      });
    }
  }

  return json({ success: true, rows });
}

async function route(body: JsonRecord): Promise<Response> {
  switch (text(body.action)) {
    case "studentLogin": return await handleStudentLogin(body);
    case "studentLogout": return await handleStudentLogout(body);
    case "saveSubmission": return await handleSaveSubmission(body);
    case "uploadPhoto": return await handleUploadPhoto(body);
    case "loadMySubmission": return await handleLoadMySubmission(body);
    case "getSharedPlants": return await handleGetSharedPlants(body);
    case "recordPlantView": return await handleRecordPlantView(body);
    case "teacherLogin": return await handleTeacherLogin(body);
    case "teacherLogout": return await handleTeacherLogout(body);
    case "getTeacherDashboard": return await handleTeacherDashboard(body);
    case "getTeacherSubmission": return await handleTeacherSubmission(body);
    case "setSubmissionVisibility": return await handleSetSubmissionVisibility(body);
    case "setStudentStatus": return await handleSetStudentStatus(body);
    case "deleteStudent": return await handleDeleteStudent(body);
    case "exportTeacherCsv": return await handleExportTeacherCsv(body);
    default: return json({ success: false, message: "지원하지 않는 요청입니다." });
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ success: false, message: "POST 요청만 지원합니다." }, 405);
  }
  if (!SUPABASE_URL || !secretKey) {
    return json({ success: false, message: "Supabase 서버 키 설정을 확인해주세요." }, 500);
  }

  const callerKey = request.headers.get("apikey") ?? "";
  if (!callerKey || !publishableKeys.includes(callerKey)) {
    return json({ success: false, message: "올바른 Publishable key가 아닙니다." }, 401);
  }

  try {
    const body = await request.json() as JsonRecord;
    return await route(body);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "서버 처리 중 오류가 발생했습니다.";
    const isSessionError = message.includes("로그인") || message.includes("계정");
    return json({
      success: false,
      message: isSessionError ? message : "서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      retryable: !isSessionError
    }, isSessionError ? 200 : 500);
  }
});
