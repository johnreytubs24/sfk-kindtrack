(function setupKindTrackFirebaseAdapter() {
  const SCRIPT_API_MARKER = "script.google.com/macros/s/";
  const COLLECTIONS = {
    students: "kindtrack_students",
    violationTypes: "kindtrack_violation_types",
    violations: "kindtrack_violations",
    settings: "kindtrack_settings",
    attendance: "kindtrack_attendance"
  };

  const originalFetch = window.fetch.bind(window);
  const serverTimestamp = () => window.firebase.firestore.FieldValue.serverTimestamp();

  function getFirestore() {
    if (!window.firebase || !window.firebase.firestore) {
      throw new Error("Firebase Firestore SDK is not loaded.");
    }

    if (!window.firebase.apps.length && window.SFK_KINDTRACK_FIREBASE_CONFIG) {
      window.firebase.initializeApp(window.SFK_KINDTRACK_FIREBASE_CONFIG);
    }

    return window.firebase.firestore();
  }

  function isKindTrackApiRequest(resource) {
    const url = typeof resource === "string" ? resource : (resource && resource.url) || "";
    return url.includes(SCRIPT_API_MARKER);
  }

  function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }

  function stripInternalFields(row) {
    const output = {};
    Object.keys(row || {}).forEach((key) => {
      if (!key.startsWith("__")) output[key] = row[key];
    });
    return output;
  }

  function normalizeDocId(value, fallback) {
    const raw = String(value || fallback || "").trim() || `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return raw.replace(/[\\/#?[\]]/g, "_").slice(0, 140);
  }

  function normalizeNameKey(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function normalizeDate(value) {
    if (!value) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }

    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return text;
  }

  function normalizeAttendanceStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    if (["late", "lates", "tardy", "tardiness"].includes(normalized)) return "Tardy";
    if (normalized === "absent") return "Absent";
    if (normalized === "excused") return "Excused";
    return "Present";
  }

  function isPaidWithKindnessStatus(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalized === "paidwithkindness" || normalized === "kindnesspaid" || normalized === "paidkindness";
  }

  function isKindnessSettlement(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").includes("kindness");
  }

  function normalizeViolationSettlement(data) {
    const status = String(data.status || data.Status || "").trim();
    let settlementType = String(data.settlementType || data.SettlementType || data["Settlement Type"] || "Cash").trim();
    let kindnessTask = String(data.kindnessTask || data.KindnessTask || data["Kindness Task"] || "").trim();
    let kindnessStatus = String(data.kindnessStatus || data.KindnessStatus || data["Kindness Status"] || "Pending").trim();
    let kindnessCompletedDate = normalizeDate(data.kindnessCompletedDate || data.KindnessCompletedDate || data["Kindness Completed Date"] || "");

    if (!settlementType) settlementType = "Cash";
    if (!kindnessStatus) kindnessStatus = "Pending";

    if (isPaidWithKindnessStatus(status)) {
      settlementType = "Kindness Alternative Payment";
      kindnessStatus = "Completed";
      if (!kindnessCompletedDate) kindnessCompletedDate = normalizeDate(new Date());
    }

    if (isKindnessSettlement(settlementType) && kindnessCompletedDate && String(kindnessStatus).toLowerCase() !== "completed") {
      kindnessStatus = "Completed";
    }

    if (!isKindnessSettlement(settlementType)) {
      kindnessTask = "";
      kindnessStatus = "Pending";
      kindnessCompletedDate = "";
    }

    return {
      SettlementType: settlementType,
      KindnessTask: kindnessTask,
      KindnessStatus: kindnessStatus,
      KindnessCompletedDate: kindnessCompletedDate
    };
  }

  async function getRows(collectionName) {
    const snapshot = await getFirestore().collection(collectionName).get();
    return snapshot.docs
      .sort((a, b) => {
        const left = a.data() || {};
        const right = b.data() || {};
        const orderA = Number(left.__order || left.Order || 0);
        const orderB = Number(right.__order || right.Order || 0);
        if (orderA || orderB) return orderA - orderB;
        return JSON.stringify(left).localeCompare(JSON.stringify(right));
      })
      .map((doc) => stripInternalFields(doc.data()));
  }

  async function handleGet() {
    const [students, violationTypes, violations, settings, attendance] = await Promise.all([
      getRows(COLLECTIONS.students),
      getRows(COLLECTIONS.violationTypes),
      getRows(COLLECTIONS.violations),
      getRows(COLLECTIONS.settings),
      getRows(COLLECTIONS.attendance)
    ]);

    return {
      students,
      violationTypes,
      violations,
      settings,
      attendance
    };
  }

  async function readJsonBody(resource, init) {
    if (init && init.body) return JSON.parse(init.body);
    if (resource && typeof resource.clone === "function") {
      const text = await resource.clone().text();
      return text ? JSON.parse(text) : {};
    }
    return {};
  }

  function buildViolationRow(data, recordId, studentId) {
    const settlement = normalizeViolationSettlement(data);
    return {
      RecordID: recordId,
      StudentID: studentId,
      Date: normalizeDate(data.date),
      ViolationType: data.violationType,
      Fee: Number(data.fee) || 0,
      Status: data.status || "Unpaid",
      ActionTaken: data.actionTaken || "",
      ReflectionCommitment: data.reflection || "",
      FollowUpDate: normalizeDate(data.followUpDate || ""),
      FollowUpStatus: data.followUpStatus || "Pending",
      ParentContacted: data.parentContacted || "No",
      Notes: data.notes || "",
      EncodedBy: data.encodedBy || "Sir JR",
      SettlementType: settlement.SettlementType,
      KindnessTask: settlement.KindnessTask,
      KindnessStatus: settlement.KindnessStatus,
      KindnessCompletedDate: settlement.KindnessCompletedDate,
      __updatedAt: serverTimestamp()
    };
  }

  async function findDocByField(collectionName, field, value) {
    const db = getFirestore();
    const direct = await db.collection(collectionName).doc(normalizeDocId(value)).get();
    if (direct.exists) return direct.ref;

    const query = await db.collection(collectionName).where(field, "==", value).limit(1).get();
    if (!query.empty) return query.docs[0].ref;
    return null;
  }

  async function getTardinessType() {
    const rows = await getRows(COLLECTIONS.violationTypes);
    return rows.find((row) => {
      const name = String(row.ViolationName || "").trim().toLowerCase();
      return name === "tardiness" || name === "tardy" || name.includes("tardy") || name.includes("late");
    }) || { ViolationName: "Tardiness", Fee: 0, KindnessAlternative: "", KindnessValue: "" };
  }

  function buildTardyAutoKey(date, studentId) {
    return `ATT-TARDY-${normalizeDate(date)}-${String(studentId).trim()}`;
  }

  async function syncTardyViolations(date, attendanceRecords) {
    const db = getFirestore();
    const batch = db.batch();
    const tardiness = await getTardinessType();
    const violationName = tardiness.ViolationName || "Tardiness";
    const violationFee = Number(tardiness.Fee) || 0;
    const kindnessTask = tardiness.KindnessAlternative
      ? `${tardiness.KindnessAlternative}${tardiness.KindnessValue ? ` (${tardiness.KindnessValue})` : ""}`
      : "";
    const result = { created: 0, updated: 0, removed: 0 };

    for (const record of attendanceRecords) {
      const studentId = String(record.studentId || record.StudentID || "").trim();
      if (!studentId) continue;

      const autoKey = buildTardyAutoKey(date, studentId);
      const existingQuery = await db.collection(COLLECTIONS.violations).where("AutoKey", "==", autoKey).limit(1).get();
      const existingRef = existingQuery.empty ? null : existingQuery.docs[0].ref;

      if (normalizeAttendanceStatus(record.status || record.Status) === "Tardy") {
        const ref = existingRef || db.collection(COLLECTIONS.violations).doc(normalizeDocId(`REC-${Date.now()}-${studentId}`));
        const row = {
          RecordID: existingRef ? existingQuery.docs[0].data().RecordID : ref.id,
          StudentID: studentId,
          Date: normalizeDate(date),
          ViolationType: violationName,
          Fee: violationFee,
          Status: existingRef ? existingQuery.docs[0].data().Status || "Unpaid" : "Unpaid",
          ActionTaken: "Attendance marked Tardy / Late",
          ReflectionCommitment: "",
          FollowUpDate: "",
          FollowUpStatus: "Pending",
          ParentContacted: "No",
          Notes: "Auto-created from Daily Attendance Tardy / Late record.",
          EncodedBy: "Daily Attendance",
          AutoSource: "AttendanceTardy",
          AutoKey: autoKey,
          SettlementType: "Cash",
          KindnessTask: kindnessTask,
          KindnessStatus: "Pending",
          KindnessCompletedDate: "",
          __updatedAt: serverTimestamp()
        };

        if (!existingRef) row.__createdAt = serverTimestamp();
        batch.set(ref, row, { merge: true });
        if (existingRef) result.updated++;
        else result.created++;
        continue;
      }

      if (existingRef) {
        batch.delete(existingRef);
        result.removed++;
      }
    }

    await batch.commit();
    return result;
  }

  async function saveAttendanceFast(data) {
    const db = getFirestore();
    const batch = db.batch();
    const date = normalizeDate(data.date);
    const records = Array.isArray(data.records) ? data.records : [];
    const savedRecords = [];

    if (!date) return { success: false, message: "Attendance date is required." };

    records.forEach((record) => {
      const studentId = String(record.studentId || record.StudentID || "").trim();
      if (!studentId) return;

      const status = normalizeAttendanceStatus(record.status || record.Status);
      const remarks = String(record.remarks || record.Remarks || "").trim();
      const attendanceId = `ATT-${date.replace(/-/g, "")}-${studentId}`;
      const ref = db.collection(COLLECTIONS.attendance).doc(normalizeDocId(attendanceId));

      savedRecords.push({ attendanceId, studentId, date, status, remarks });

      if (status === "Present" && !remarks) {
        batch.delete(ref);
        return;
      }

      batch.set(ref, {
        AttendanceID: attendanceId,
        StudentID: studentId,
        Date: date,
        Status: status,
        Remarks: remarks,
        __updatedAt: serverTimestamp()
      }, { merge: true });
    });

    await batch.commit();

    const syncResult = data.syncTardyViolations === false
      ? { created: 0, updated: 0, removed: 0 }
      : await syncTardyViolations(date, savedRecords);

    return {
      success: true,
      records: savedRecords,
      changedCount: savedRecords.length,
      fastMode: true,
      savedMode: "changed-records-only",
      tardyViolationSync: syncResult
    };
  }

  async function saveAttendance(data) {
    const db = getFirestore();
    const date = normalizeDate(data.date);
    const records = Array.isArray(data.records) ? data.records : [];
    const existing = await db.collection(COLLECTIONS.attendance).where("Date", "==", date).get();
    const batch = db.batch();
    const savedRecords = [];

    existing.docs.forEach((doc) => batch.delete(doc.ref));

    records.forEach((record) => {
      const studentId = String(record.studentId || record.StudentID || "").trim();
      if (!studentId) return;

      const status = normalizeAttendanceStatus(record.status || record.Status);
      const remarks = String(record.remarks || record.Remarks || "").trim();
      const attendanceId = `ATT-${date.replace(/-/g, "")}-${studentId}`;
      savedRecords.push({ attendanceId, studentId, date, status, remarks });

      if (status === "Present" && !remarks) return;

      batch.set(db.collection(COLLECTIONS.attendance).doc(normalizeDocId(attendanceId)), {
        AttendanceID: attendanceId,
        StudentID: studentId,
        Date: date,
        Status: status,
        Remarks: remarks,
        __updatedAt: serverTimestamp()
      });
    });

    await batch.commit();

    const syncResult = data.syncTardyViolations === false
      ? { created: 0, updated: 0, removed: 0 }
      : await syncTardyViolations(date, savedRecords);

    return { success: true, records: savedRecords, tardyViolationSync: syncResult };
  }

  async function bulkAddViolationTypes(data) {
    const db = getFirestore();
    const records = Array.isArray(data.records) ? data.records : [];
    const existingRows = await getRows(COLLECTIONS.violationTypes);
    const existingNames = {};
    let maxNumber = 0;
    let added = 0;
    let skipped = 0;
    const batch = db.batch();

    existingRows.forEach((row) => {
      const nameKey = normalizeNameKey(row.ViolationName);
      if (nameKey) existingNames[nameKey] = true;
      const idMatch = String(row.ViolationID || "").match(/(\d+)/);
      if (idMatch) maxNumber = Math.max(maxNumber, Number(idMatch[1]) || 0);
    });

    records.forEach((record) => {
      const name = String(record.name || record.ViolationName || "").trim();
      const nameKey = normalizeNameKey(name);

      if (!name || existingNames[nameKey]) {
        skipped++;
        return;
      }

      maxNumber++;
      const violationId = `V${String(maxNumber).padStart(3, "0")}`;
      batch.set(db.collection(COLLECTIONS.violationTypes).doc(normalizeDocId(violationId)), {
        ViolationID: violationId,
        ViolationName: name,
        Fee: Number(record.fee || record.Fee) || 0,
        AlertThreshold: Number(record.threshold || record.AlertThreshold) || 3,
        Category: String(record.category || record.Category || "").trim(),
        KindnessAlternative: String(record.kindnessAlternative || record.KindnessAlternative || record["Kindness Alternative"] || "").trim(),
        KindnessValue: String(record.kindnessValue || record.KindnessValue || record["Kindness Value"] || "").trim(),
        __createdAt: serverTimestamp(),
        __updatedAt: serverTimestamp()
      });

      existingNames[nameKey] = true;
      added++;
    });

    await batch.commit();
    return { success: true, added, skipped };
  }

  async function addViolation(data) {
    const db = getFirestore();
    const recordId = `REC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const row = buildViolationRow(data, recordId, data.studentId);
    row.__createdAt = serverTimestamp();
    await db.collection(COLLECTIONS.violations).doc(normalizeDocId(recordId)).set(row);
    return { success: true, recordId, savedSettlement: normalizeViolationSettlement(data) };
  }

  async function bulkAddViolations(data) {
    const db = getFirestore();
    const studentIds = Array.from(new Set((Array.isArray(data.studentIds) ? data.studentIds : [])
      .map((studentId) => String(studentId || "").trim())
      .filter(Boolean)));

    if (!studentIds.length) return { success: false, message: "No students selected" };

    const batch = db.batch();
    const timestamp = Date.now();
    const requestKey = Math.random().toString(36).slice(2, 8);
    const recordIds = studentIds.map((studentId, index) => `REC-${timestamp}-${requestKey}-${index + 1}`);

    studentIds.forEach((studentId, index) => {
      const row = buildViolationRow(data, recordIds[index], studentId);
      row.__createdAt = serverTimestamp();
      batch.set(db.collection(COLLECTIONS.violations).doc(normalizeDocId(recordIds[index])), row);
    });

    await batch.commit();
    return {
      success: true,
      savedCount: studentIds.length,
      recordIds,
      savedSettlement: normalizeViolationSettlement(data)
    };
  }

  async function saveViolationsDirect(data, selectedStudentIds) {
    if (window.SFK_KINDTRACK_AUTH) {
      const signedIn = await window.SFK_KINDTRACK_AUTH.ensureSignedIn();
      if (!signedIn) {
        return { success: false, message: "Firebase admin login is required to save changes." };
      }
    }

    const studentIds = Array.from(new Set((Array.isArray(selectedStudentIds) ? selectedStudentIds : [])
      .map((studentId) => String(studentId || "").trim())
      .filter(Boolean)));

    if (!studentIds.length) {
      return { success: false, message: "No students selected" };
    }

    if (studentIds.length === 1) {
      return addViolation({ ...data, studentId: studentIds[0] });
    }

    return bulkAddViolations({ ...data, studentIds });
  }

  async function editViolation(data) {
    const ref = await findDocByField(COLLECTIONS.violations, "RecordID", data.recordId);
    if (!ref) return { success: false, message: "Record not found" };

    const settlement = normalizeViolationSettlement(data);
    await ref.set({
      Date: normalizeDate(data.date),
      ViolationType: data.violationType,
      Fee: Number(data.fee) || 0,
      Status: data.status,
      ActionTaken: data.actionTaken || "",
      ReflectionCommitment: data.reflection || "",
      FollowUpDate: normalizeDate(data.followUpDate || ""),
      FollowUpStatus: data.followUpStatus || "Pending",
      ParentContacted: data.parentContacted || "No",
      Notes: data.notes || "",
      SettlementType: settlement.SettlementType,
      KindnessTask: settlement.KindnessTask,
      KindnessStatus: settlement.KindnessStatus,
      KindnessCompletedDate: settlement.KindnessCompletedDate,
      __updatedAt: serverTimestamp()
    }, { merge: true });

    return { success: true, savedSettlement: settlement };
  }

  async function deleteViolation(data) {
    const ref = await findDocByField(COLLECTIONS.violations, "RecordID", data.recordId);
    if (!ref) return { success: false, message: "Record not found" };
    await ref.delete();
    return { success: true };
  }

  async function handlePost(data) {
    if (data.action === "saveAttendanceFast") return saveAttendanceFast(data);
    if (data.action === "saveAttendance") return saveAttendance(data);
    if (data.action === "bulkAddViolationTypes") return bulkAddViolationTypes(data);
    if (data.action === "bulkAddViolations") return bulkAddViolations(data);
    if (data.action === "addViolation") return addViolation(data);
    if (data.action === "editViolation") return editViolation(data);
    if (data.action === "deleteViolation") return deleteViolation(data);
    return { success: false, message: "Invalid action" };
  }

  window.fetch = async function kindTrackFirebaseFetch(resource, init = {}) {
    if (!isKindTrackApiRequest(resource)) {
      return originalFetch(resource, init);
    }

    try {
      const method = String((init && init.method) || (resource && resource.method) || "GET").toUpperCase();
      if (method === "POST") {
        if (window.SFK_KINDTRACK_AUTH) {
          const signedIn = await window.SFK_KINDTRACK_AUTH.ensureSignedIn();
          if (!signedIn) {
            return jsonResponse({ success: false, message: "Firebase admin login is required to save changes." }, 401);
          }
        }
        return jsonResponse(await handlePost(await readJsonBody(resource, init)));
      }
      return jsonResponse(await handleGet());
    } catch (error) {
      console.error("KindTrack Firebase adapter error:", error);
      return jsonResponse({ success: false, message: error.message || "Firebase adapter error" }, 500);
    }
  };

  window.SFK_KINDTRACK_FIREBASE_ADAPTER = {
    collections: COLLECTIONS,
    loadAll: handleGet,
    saveViolations: saveViolationsDirect
  };
})();
