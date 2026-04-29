import { appConfig } from "../config.js";
import { createUuid, enrichPointForProject, nowIso, todayValue, toNullableNumber, toNumber } from "../core/helpers.js";
import { validateCollar } from "../core/validators.js";
import { deleteCollarByLocalId, getCollarByUuid, saveCollar } from "../db/collarRepository.js";
import { removeSyncItemsByEntity } from "../db/syncRepository.js";
import { enqueueChange } from "./syncService.js";

function buildBaseCollar(data, activeProject, capturedPoint) {
  const coordinates = enrichPointForProject(
    {
      latitude: toNullableNumber(data.latitude),
      longitude: toNullableNumber(data.longitude),
      elevacion: toNullableNumber(data.elevacion),
      geometry: capturedPoint?.geometry || data.geometry || null,
    },
    activeProject.sr_proyecto,
  );
  const elevationStatus = capturedPoint?.elevation_status || (coordinates.elevacion != null ? "resolved" : "pending");
  const elevationResolvedAt = elevationStatus === "resolved"
    ? capturedPoint?.elevation_resolved_at || nowIso()
    : "";

  return {
    proyecto_uuid: activeProject.uuid,
    proyecto_global_id_remoto: activeProject.global_id_remoto || "",
    hole_id: data.hole_id.trim(),
    este: coordinates.este,
    norte: coordinates.norte,
    elevacion: coordinates.elevacion,
    prof_total: toNumber(data.prof_total),
    tipo: data.tipo.trim(),
    localizacion: data.localizacion.trim(),
    fecha: data.fecha || todayValue(),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    geometry: coordinates.geometry,
    elevation_status: elevationStatus,
    elevation_source: capturedPoint?.elevation_source || "",
    elevation_resolved_at: elevationResolvedAt,
  };
}

export async function createCollar(data, activeProject, capturedPoint) {
  if (!activeProject) {
    throw new Error("Debes crear o seleccionar un proyecto activo antes de registrar un collar.");
  }

  const now = nowIso();
  const collar = {
    uuid: createUuid(),
    global_id_remoto: "",
    remote_object_id: "",
    ...buildBaseCollar(data, activeProject, capturedPoint),
    estado_sync: appConfig.status.pending,
    fecha_creacion: now,
    fecha_modificacion: now,
  };

  const errors = validateCollar(collar);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  const savedCollar = await saveCollar(collar);
  await enqueueChange("collar", savedCollar.uuid, "create", savedCollar);
  return savedCollar;
}

export async function updateCollar(uuid, data, activeProject, capturedPoint) {
  const existingCollar = await getCollarByUuid(uuid);
  if (!existingCollar) {
    throw new Error("No se encontro el collar a editar.");
  }

  const nextCollar = {
    ...existingCollar,
    ...buildBaseCollar(data, activeProject, capturedPoint),
    fecha_modificacion: nowIso(),
    estado_sync: appConfig.status.pending,
  };

  const errors = validateCollar(nextCollar);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  await saveCollar(nextCollar);
  await enqueueChange("collar", nextCollar.uuid, "update", nextCollar);
  return nextCollar;
}

export async function deleteCollar(uuid) {
  const existingCollar = await getCollarByUuid(uuid);
  if (!existingCollar) {
    throw new Error("No se encontro el collar a eliminar.");
  }

  await removeSyncItemsByEntity("collar", existingCollar.uuid);

  if (existingCollar.global_id_remoto || existingCollar.remote_object_id) {
    await enqueueChange("collar", existingCollar.uuid, "delete", existingCollar);
  }

  await deleteCollarByLocalId(existingCollar.id_local);
  return existingCollar;
}