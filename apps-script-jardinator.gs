// ================================================================
// JARDINATOR — Script Google Apps Script
// À coller dans : Google Sheets > Extensions > Apps Script
// ================================================================
//
// ÉTAPES D'INSTALLATION :
// 1. Ouvrez votre Google Sheet
// 2. Menu : Extensions > Apps Script
// 3. Collez tout ce code
// 4. Remplacez API_TOKEN ci-dessous par un jeton généré au hasard
//    (ex : dans la console du navigateur : crypto.randomUUID())
// 5. Cliquez sur Déployer > Nouveau déploiement
// 6. Type : Application Web
// 7. Exécuter en tant que : Moi
// 8. Accès autorisé à : Tout le monde
// 9. Copiez l'URL générée
// 10. Dans index.html, renseignez SHEETS_WEBHOOK_URL et API_TOKEN
//
// ⚠ IMPORTANT — portée réelle du jeton :
// L'app est un fichier HTML servi au navigateur. Le jeton y est donc
// forcément lisible par qui ouvre l'app. Il protège contre « quelqu'un
// est tombé sur l'URL du webhook », pas contre « quelqu'un a accès à
// l'app ». C'est une mitigation, pas une authentification. Une vraie
// authentification demanderait un compte Google par utilisateur.
// ================================================================

const SHEET_NAME  = 'Chantiers';                // Onglet dans le Google Sheet
const API_TOKEN   = 'REMPLACEZ_PAR_VOTRE_JETON'; // cf. étape 4
const ROOT_FOLDER = 'Jardinator Chantiers';     // Dossier Drive racine des photos

// Ordre des colonnes de la feuille. L'index = position (1-based).
const COL = {
  id:             1,
  statut:         2,
  client:         3,
  adresse:        4,
  devis:          5,
  consignes:      6,
  notes:          7,
  nbPhotos:       8,
  signature:      9,
  date:          10,
  dateTermine:   11,
  driveFolderUrl:12,
  driveFolderId: 13,
  signatureUrl:  14,
  photosJson:    15,
  devisId:       16,
  devisUrl:      17
};
const HEADERS = [
  'ID Chantier', 'Statut', 'Nom Client', 'Adresse',
  'Devis', 'Consignes', 'Notes Terrain',
  'Nb Photos', 'Signature Client', 'Date Prévue', 'Date Clôture',
  'Dossier Drive', 'Drive Folder ID', 'Signature (image)',
  'Photos (interne)', 'Devis ID', 'Devis URL'
];
const NB_COLS = HEADERS.length;

// Au-delà, une photo ne passe plus dans une cellule ni dans un POST
// Apps Script confortablement. Le front compresse déjà à ~300 Ko.
const MAX_UPLOAD_MO = 12;

// ================================================================
// ROUTAGE
// ================================================================
//
// Le front appelle tout en GET (une requête GET est une « simple request »
// au sens CORS : pas de préflight OPTIONS, que Apps Script ne sait pas gérer).
// Les envois volumineux (signature, photo) passent en POST avec
// Content-Type: text/plain, qui évite lui aussi le préflight.

function doGet(e) {
  const p = (e && e.parameter) || {};

  if (p.action === 'ping') return json_({ success: true, status: 'Jardinator API opérationnelle' });
  if (!checkToken_(p)) return json_({ success: false, error: 'unauthorized' });

  try {
    switch (p.action) {
      case 'save':   return json_(saveChantier_(p));
      case 'delete': return json_(deleteChantier_(p.id));
      case 'folder': return json_(ensureFolder_(p.id));
      case 'file':   return json_(readFile_(p.fileId));
      case 'list':
      default:       return json_({ success: true, chantiers: readAll_() });
    }
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ success: false, error: 'body JSON invalide' });
  }

  if (!checkToken_(body)) return json_({ success: false, error: 'unauthorized' });

  try {
    switch (body.action) {
      case 'signature':   return json_(uploadSignature_(body));
      case 'photo':       return json_(uploadPhoto_(body));
      case 'devis':       return json_(uploadDevis_(body));
      case 'deletePhoto': return json_(deletePhoto_(body));
      case 'save':        return json_(saveChantier_(body));
      case 'delete':      return json_(deleteChantier_(body.id));
      default:            return json_({ success: false, error: 'action inconnue' });
    }
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}

function checkToken_(p) {
  return API_TOKEN === 'REMPLACEZ_PAR_VOTRE_JETON' || p.token === API_TOKEN;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ================================================================
// FEUILLE
// ================================================================

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (sheet) { migrer_(sheet); return sheet; }

  sheet = ss.insertSheet(SHEET_NAME);
  ecrireEntetes_(sheet);
  sheet.setFrozenRows(1);

  // Les colonnes de date sont en texte brut : sinon Sheets convertit
  // « 2026-08-27 » en objet Date et le front réaffiche un ISO illisible.
  sheet.getRange(2, COL.date, sheet.getMaxRows() - 1, 2).setNumberFormat('@');

  const widths = { 1:90, 2:100, 3:160, 4:250, 5:180, 6:300, 7:250, 8:80, 9:100, 10:100, 11:100, 12:220 };
  Object.keys(widths).forEach(c => sheet.setColumnWidth(Number(c), widths[c]));
  masquerTechniques_(sheet);

  return sheet;
}

function ecrireEntetes_(sheet) {
  sheet.getRange(1, 1, 1, NB_COLS).setValues([HEADERS])
    .setBackground('#1A1A1A').setFontColor('#FFFFFF').setFontWeight('bold');
}

function masquerTechniques_(sheet) {
  // Colonnes techniques (ids Drive, JSON photos) : masquées, la feuille
  // reste lisible pour le bureau.
  sheet.hideColumns(COL.driveFolderId, NB_COLS - COL.driveFolderId + 1);
}

// Une feuille créée par une version antérieure n'a que 11 colonnes. Sans
// ça, le script écrirait dans des colonnes sans en-tête et les données
// existantes deviendraient illisibles pour le bureau.
function migrer_(sheet) {
  if (sheet.getLastColumn() >= NB_COLS &&
      cell_(sheet.getRange(1, NB_COLS).getValue()) === HEADERS[NB_COLS - 1]) return;

  if (sheet.getMaxColumns() < NB_COLS) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), NB_COLS - sheet.getMaxColumns());
  }
  ecrireEntetes_(sheet);
  sheet.getRange(2, COL.date, Math.max(1, sheet.getMaxRows() - 1), 2).setNumberFormat('@');
  masquerTechniques_(sheet);
}

// Normalise une cellule en chaîne. Sheets peut renvoyer un objet Date
// même sur une colonne formatée texte (anciennes lignes) — on reformate.
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

function readAll_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, NB_COLS).getValues()
    .filter(r => cell_(r[COL.id - 1]) !== '')
    .map(r => ({
      id:             cell_(r[COL.id - 1]),
      statut:         cell_(r[COL.statut - 1]),
      client:         cell_(r[COL.client - 1]),
      adresse:        cell_(r[COL.adresse - 1]),
      devis:          cell_(r[COL.devis - 1]),
      consignes:      cell_(r[COL.consignes - 1]),
      notes:          cell_(r[COL.notes - 1]),
      nbPhotos:       Number(r[COL.nbPhotos - 1]) || 0,
      date:           cell_(r[COL.date - 1]),
      dateTermine:    cell_(r[COL.dateTermine - 1]),
      driveFolderId:  cell_(r[COL.driveFolderId - 1]),
      driveFolderUrl: cell_(r[COL.driveFolderUrl - 1]),
      signatureUrl:   cell_(r[COL.signatureUrl - 1]),
      devisId:        cell_(r[COL.devisId - 1]),
      devisUrl:       cell_(r[COL.devisUrl - 1]),
      // Le front distingue « signée mais image non chargée » (= 'signed')
      // de « pas de signature » (= null). Il ne reçoit jamais le dataURL.
      signature:      cell_(r[COL.signature - 1]) === 'Oui' ? 'signed' : null,
      // Métadonnées seulement : {fileId, nom}. Les octets se récupèrent
      // à la demande via action=file, et sont mis en cache par le front.
      photos:         parsePhotos_(r[COL.photosJson - 1])
    }));
}

function parsePhotos_(v) {
  const s = cell_(v);
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; }
  catch (err) { return []; }
}

function findRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !id) return -1;
  const ids = sheet.getRange(2, COL.id, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (cell_(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// ================================================================
// ÉCRITURES
// ================================================================
//
// Verrou : deux ouvriers peuvent clôturer un chantier en même temps.
// Sans lock, appendRow concurrents peuvent écrire sur la même ligne.

function saveChantier_(p) {
  if (!p.id) return { success: false, error: 'id manquant' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    let row = findRow_(sheet, p.id);
    const isNew = row < 0;

    // Dossier Drive : PAS créé ici. Créer un dossier coûte deux appels
    // Drive, et « save » est sur le chemin critique du terrain (bouton
    // Valider). Le dossier est créé à la demande, au premier upload ou
    // au clic sur « Ouvrir le dossier » — cf. ensureFolder_().
    let folderId  = p.driveFolderId  || '';
    let folderUrl = p.driveFolderUrl || '';
    if (!folderId && !isNew) {
      folderId  = cell_(sheet.getRange(row, COL.driveFolderId).getValue());
      folderUrl = cell_(sheet.getRange(row, COL.driveFolderUrl).getValue());
    }

    // Photos, signature et devis existants : « save » ne les connaît pas
    // (ils passent par leurs propres actions), donc il ne doit surtout
    // pas les écraser avec du vide.
    const prevPhotos   = isNew ? 0  : sheet.getRange(row, COL.nbPhotos).getValue();
    const prevSigUrl   = isNew ? '' : sheet.getRange(row, COL.signatureUrl).getValue();
    const prevPhotosJs = isNew ? '' : cell_(sheet.getRange(row, COL.photosJson).getValue());
    const prevDevisId  = isNew ? '' : cell_(sheet.getRange(row, COL.devisId).getValue());
    const prevDevisUrl = isNew ? '' : cell_(sheet.getRange(row, COL.devisUrl).getValue());

    // Date de clôture : uniquement quand le chantier passe à Terminé.
    // (L'ancienne version l'écrivait dès la création.)
    let dateTermine = isNew ? '' : cell_(sheet.getRange(row, COL.dateTermine).getValue());
    if (p.statut === 'Terminé' && !dateTermine) {
      dateTermine = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
    } else if (p.statut !== 'Terminé') {
      dateTermine = '';
    }

    const rowData = [];
    rowData[COL.id - 1]             = p.id;
    rowData[COL.statut - 1]         = p.statut || 'À faire';
    rowData[COL.client - 1]         = p.client || '';
    rowData[COL.adresse - 1]        = p.adresse || '';
    rowData[COL.devis - 1]          = p.devis || '';
    rowData[COL.consignes - 1]      = p.consignes || '';
    rowData[COL.notes - 1]          = p.notes || '';
    rowData[COL.nbPhotos - 1]       = Number(prevPhotos) || 0;
    rowData[COL.signature - 1]      = p.signature === 'Oui' ? 'Oui' : (prevSigUrl ? 'Oui' : 'Non');
    rowData[COL.date - 1]           = p.date || '';
    rowData[COL.dateTermine - 1]    = dateTermine;
    rowData[COL.driveFolderUrl - 1] = folderUrl;
    rowData[COL.driveFolderId - 1]  = folderId;
    rowData[COL.signatureUrl - 1]   = prevSigUrl;
    rowData[COL.photosJson - 1]     = prevPhotosJs;
    rowData[COL.devisId - 1]        = prevDevisId;
    rowData[COL.devisUrl - 1]       = prevDevisUrl;

    if (isNew) row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, NB_COLS).setValues([rowData]);
    colorRow_(sheet, row, rowData[COL.statut - 1]);

    return { success: true, row: row, driveFolderId: folderId, driveFolderUrl: folderUrl };
  } finally {
    lock.releaseLock();
  }
}

function deleteChantier_(id) {
  if (!id) return { success: false, error: 'id manquant' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, id);
    if (row < 0) return { success: true, deleted: false }; // déjà absent

    // La ligne part, le dossier Drive reste : les photos d'un chantier
    // facturé ne doivent pas disparaître sur une fausse manip terrain.
    sheet.deleteRow(row);
    return { success: true, deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function colorRow_(sheet, row, statut) {
  const range = sheet.getRange(row, 1, 1, NB_COLS);
  const cell  = sheet.getRange(row, COL.statut);
  if (statut === 'Terminé') {
    range.setBackground('#E8F5E9'); cell.setFontColor('#2E7D32');
  } else if (statut === 'En cours') {
    range.setBackground('#E6F1FB'); cell.setFontColor('#185FA5');
  } else {
    range.setBackground('#FAEEDA'); cell.setFontColor('#BA7517');
  }
}

// ================================================================
// DRIVE — photos et signature
// ================================================================

function getRootFolder_() {
  const it = DriveApp.getFoldersByName(ROOT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER);
}

function createChantierFolder_(id, client) {
  const root = getRootFolder_();
  const name = id + (client ? ' - ' + client : '');
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

// Appelé par le bouton « Ouvrir le dossier photos » : crée le dossier
// s'il n'existe pas encore et renvoie son URL.
function ensureFolder_(id) {
  const sheet = getSheet_();
  const row = findRow_(sheet, id);
  if (row < 0) return { success: false, error: 'chantier introuvable' };
  const folder = getFolderForChantier_(sheet, row);
  return { success: true, driveFolderId: folder.getId(), driveFolderUrl: folder.getUrl() };
}

function getFolderForChantier_(sheet, row) {
  const id = String(sheet.getRange(row, COL.driveFolderId).getValue() || '');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* dossier supprimé */ }
  }
  const folder = createChantierFolder_(
    cell_(sheet.getRange(row, COL.id).getValue()),
    cell_(sheet.getRange(row, COL.client).getValue())
  );
  sheet.getRange(row, COL.driveFolderId).setValue(folder.getId());
  sheet.getRange(row, COL.driveFolderUrl).setValue(folder.getUrl());
  return folder;
}

// dataUrl attendu : "data:image/png;base64,AAAA..."
function decodeDataUrl_(dataUrl, fallbackName) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('fichier invalide');
  if (m[2].length * 3 / 4 > MAX_UPLOAD_MO * 1024 * 1024) {
    throw new Error('fichier trop volumineux (max ' + MAX_UPLOAD_MO + ' Mo)');
  }
  const ext = (m[1].split('/')[1] || 'bin').replace('jpeg', 'jpg');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], fallbackName + '.' + ext);
}

function uploadSignature_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, body.id);
    if (row < 0) return { success: false, error: 'chantier introuvable' };

    const folder = getFolderForChantier_(sheet, row);
    const blob = decodeDataUrl_(body.dataUrl, 'signature-' + body.id);

    // Une seule signature par chantier : on remplace l'ancienne.
    const old = folder.getFilesByName(blob.getName());
    while (old.hasNext()) old.next().setTrashed(true);

    const file = folder.createFile(blob);
    sheet.getRange(row, COL.signature).setValue('Oui');
    sheet.getRange(row, COL.signatureUrl).setValue(file.getUrl());

    return { success: true, signatureUrl: file.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

function uploadPhoto_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, body.id);
    if (row < 0) return { success: false, error: 'chantier introuvable' };

    const folder = getFolderForChantier_(sheet, row);
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    const name  = 'photo-' + stamp + '-' + Math.floor(Math.random() * 10000);
    const file  = folder.createFile(decodeDataUrl_(body.dataUrl, name));

    // Le front envoie sa clé locale : elle permet de rattacher la photo
    // déjà affichée sur l'appareil au fichier Drive qui vient d'être créé,
    // sans dupliquer la vignette.
    const photos = parsePhotos_(sheet.getRange(row, COL.photosJson).getValue());
    photos.push({ fileId: file.getId(), nom: file.getName(), cle: body.cle || '' });
    sheet.getRange(row, COL.photosJson).setValue(JSON.stringify(photos));
    sheet.getRange(row, COL.nbPhotos).setValue(photos.length);

    return { success: true, fileId: file.getId(), nom: file.getName(), nbPhotos: photos.length };
  } finally {
    lock.releaseLock();
  }
}

function deletePhoto_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, body.id);
    if (row < 0) return { success: false, error: 'chantier introuvable' };

    const photos = parsePhotos_(sheet.getRange(row, COL.photosJson).getValue());
    const reste  = photos.filter(p => p.fileId !== body.fileId);
    sheet.getRange(row, COL.photosJson).setValue(JSON.stringify(reste));
    sheet.getRange(row, COL.nbPhotos).setValue(reste.length);

    // Corbeille, pas suppression définitive : une photo de chantier
    // supprimée par erreur reste récupérable 30 jours dans Drive.
    try { DriveApp.getFileById(body.fileId).setTrashed(true); } catch (err) {}

    return { success: true, nbPhotos: reste.length };
  } finally {
    lock.releaseLock();
  }
}

function uploadDevis_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, body.id);
    if (row < 0) return { success: false, error: 'chantier introuvable' };

    const folder = getFolderForChantier_(sheet, row);
    const nom = body.nom || ('devis-' + body.id + '.pdf');

    // Un seul devis par chantier : l'ancien part à la corbeille.
    const ancien = cell_(sheet.getRange(row, COL.devisId).getValue());
    if (ancien) { try { DriveApp.getFileById(ancien).setTrashed(true); } catch (err) {} }

    const file = folder.createFile(decodeDataUrl_(body.dataUrl, nom.replace(/\.[^.]+$/, '')));
    file.setName(nom);

    sheet.getRange(row, COL.devis).setValue(nom);
    sheet.getRange(row, COL.devisId).setValue(file.getId());
    sheet.getRange(row, COL.devisUrl).setValue(file.getUrl());

    return { success: true, devisId: file.getId(), devisUrl: file.getUrl(), nom: nom };
  } finally {
    lock.releaseLock();
  }
}

// Proxy de lecture : renvoie les octets d'un fichier en base64.
//
// C'est ce qui permet d'afficher les photos DANS l'app sans passer les
// fichiers Drive en « accessible à toute personne ayant le lien ». Ce
// sont des photos de propriétés privées rattachées à un nom et une
// adresse : un lien public le resterait indéfiniment.
function readFile_(fileId) {
  if (!fileId) return { success: false, error: 'fileId manquant' };
  let file;
  try { file = DriveApp.getFileById(fileId); }
  catch (err) { return { success: false, error: 'fichier introuvable' }; }

  // Sans ce contrôle, le jeton permettrait de lire N'IMPORTE QUEL
  // fichier du Drive du compte, pas seulement ceux de l'app.
  if (!dansDossierJardinator_(file)) return { success: false, error: 'accès refusé' };

  const blob = file.getBlob();
  return {
    success: true,
    nom: file.getName(),
    dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes())
  };
}

function dansDossierJardinator_(file) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    const grands = p.getParents();
    while (grands.hasNext()) {
      if (grands.next().getName() === ROOT_FOLDER) return true;
    }
  }
  return false;
}
