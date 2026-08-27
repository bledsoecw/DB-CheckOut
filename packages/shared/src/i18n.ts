/**
 * Bilingual labels for DB CheckOut.
 *
 * The app is Spanish-first: `es` renders large, `en` renders small below.
 * Flipping the ES·EN pill swaps which one leads. Answers are always STORED
 * as the canonical JT values (OK / N/A / ACTION) regardless of display.
 */

export type Lang = "es" | "en";

export interface Bi {
  es: string;
  en: string;
}

/** Checklist item labels keyed by JT form field id. */
export const FIELD_LABELS: Record<string, Bi> = {
  // DB Final Roofing Inspection
  "22PdEQfPnVqh": { es: "Tejas parejas, sin clavos expuestos", en: "Shingles flat — no exposed nails" },
  "22PdEQfPnVqi": { es: "Drip edge y bordes firmes", en: "Starter & drip edge secure" },
  "22PdEQfPnVqj": { es: "Caballete completo, valles limpios", en: "Ridge caps seated — valleys clean" },
  "22PdEQfPnVqk": { es: "Botas y ventilas bien selladas", en: "Pipe boots & vents sealed" },
  "22PdEQfPnVqm": { es: "Flashing en paredes completo", en: "Step & wall flashing complete" },
  "22PdEQfPnVqn": { es: "Chimenea y tragaluz con flashing", en: "Chimney & skylight flashed" },
  "22PdEQfPnVqp": { es: "Techo limpio, sin exceso de sellador", en: "Roof clean — sealant used right" },
  "22PdEQfPnVqq": { es: "Revisión del ático — puntos de fuga", en: "Attic spot check — leak-prone areas" },
  "22PdEQfPnVqr": { es: "Limitación de acceso / condiciones existentes", en: "Access limitation / existing conditions" },
  "22PdEQfPnVqs": { es: "Notas", en: "Notes" },
  // DB Site Cleanup
  "22PdEQhB6rSR": { es: "Barrido con imán — entrada, banquetas y jardín", en: "Magnet sweep — driveway, walks & yard" },
  "22PdEQhB6rSS": { es: "Materiales, lonas y basura recogidos", en: "Materials, tarps & trash removed" },
  "22PdEQhB6rST": { es: "Canales y bajantes limpios y conectados", en: "Gutters & downspouts clean, reconnected" },
  "22PdEQhB6rSU": { es: "Sin daños — siding, ventanas, AC, plantas", en: "No damage — siding, windows, AC, plants" },
  "22PdEQhB6rSV": { es: "Listo para que lo vea el cliente", en: "Ready for the homeowner to view" },
  "22PdEQhB6rSW": { es: "Notas", en: "Notes" },
};

/** Answer button labels (canonical value -> display). */
export const ANSWER_LABELS: Record<string, Bi> = {
  OK: { es: "BIEN", en: "OK" },
  "N/A": { es: "N/A", en: "N/A" },
  ACTION: { es: "FALLA", en: "FIX" },
};

/** UI strings. Keep keys stable — screens reference them by name. */
export const UI: Record<string, Bi> = {
  myJobs: { es: "Mis trabajos", en: "My jobs" },
  jobsToday: { es: "trabajos hoy", en: "jobs today" },
  offlineSaved: { es: "Sin señal — todo se guarda", en: "No signal — everything is saved" },
  offlineDetail: { es: "Se envía solo cuando haya señal", en: "Sends by itself when there's signal" },
  directions: { es: "Cómo llegar", en: "Directions" },
  start: { es: "Empezar", en: "Start" },
  continue_: { es: "Continuar", en: "Continue" },
  inspection: { es: "Inspección", en: "Inspection" },
  cleanup: { es: "Limpieza", en: "Cleanup" },
  reportProblem: { es: "Reportar problema", en: "Report a problem" },
  repairs: { es: "Reparaciones", en: "Repairs" },
  mine: { es: "Míos", en: "Mine" },
  everyone: { es: "Todos", en: "Everyone" },
  forYou: { es: "para ti", en: "for you" },
  assignedTo: { es: "Para", en: "For" },
  nothingForYou: {
    es: "Nada para ti en este trabajo. Toca Todos para ver el resto.",
    en: "Nothing here is yours. Tap Everyone to see the rest.",
  },
  seeRepairs: { es: "Ver reparaciones", en: "See the repairs" },
  holdAndSpeak: { es: "Mantén presionado y habla", en: "Hold & speak" },
  speakAnyLanguage: { es: "Español o inglés, como salga", en: "Spanish or English, either way" },
  heard: { es: "SE ESCUCHÓ", en: "HEARD" },
  englishNote: { es: "Nota en inglés para la oficina", en: "English note for the office" },
  whereIsIt: { es: "¿Dónde está?", en: "Where is it?" },
  front: { es: "Frente", en: "Front" },
  back: { es: "Atrás", en: "Back" },
  left: { es: "Izquierda", en: "Left" },
  right: { es: "Derecha", en: "Right" },
  sendReport: { es: "Enviar reporte", en: "Send report" },
  pmAssigns: { es: "El PM lo ve en JobTread y asigna la reparación", en: "The PM sees it in JobTread & assigns the repair" },
  takePhoto: { es: "Tomar foto", en: "Take a photo" },
  photoRequired: { es: "FOTO OBLIGATORIA", en: "PHOTO REQUIRED" },
  beforePhoto: { es: "ANTES", en: "BEFORE" },
  afterPhoto: { es: "Foto de DESPUÉS", en: "AFTER photo" },
  afterPhotoRequired: { es: "Obligatoria para terminar", en: "Required to finish" },
  whatToDo: { es: "QUÉ HACER", en: "WHAT TO DO" },
  bring: { es: "Lleva", en: "Bring" },
  done: { es: "Terminado", en: "Done" },
  pmChecks: { es: "El PM lo revisa y lo cierra en JobTread", en: "The PM checks it & closes it in JobTread" },
  allDone: { es: "Todo listo", en: "All done" },
  checkAndSend: { es: "Revisa y manda", en: "Check & send" },
  sendToJobTread: { es: "Enviar a JobTread", en: "Send to JobTread" },
  problemsReported: { es: "problemas reportados", en: "problems reported" },
  finish: { es: "Terminar", en: "Finish" },
  finishAndSend: { es: "Terminar y enviar", en: "Finish & send" },
  itemsLeft: { es: "puntos faltan", en: "items left" },
  assignedToYou: { es: "Te lo asignó", en: "Assigned to you by" },
  queueNote: { es: "Solo aparecen trabajos listos para revisar", en: "Only jobs ready to inspect show here" },
  addNote: { es: "Agregar nota", en: "Add a note" },
  seeDamageReport: { es: "¿Ves un daño? Repórtalo con foto", en: "See damage? Report it with a photo" },
};

export function pick(bi: Bi, lang: Lang): string {
  return lang === "es" ? bi.es : bi.en;
}

/** The secondary line under a primary label (the other language). */
export function secondary(bi: Bi, lang: Lang): string {
  return lang === "es" ? bi.en : bi.es;
}
