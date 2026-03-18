// ================================================================
// JARDINATOR — Script Google Apps Script
// À coller dans : Google Sheets > Extensions > Apps Script
// ================================================================
//
// ÉTAPES D'INSTALLATION :
// 1. Ouvrez votre Google Sheet
// 2. Menu : Extensions > Apps Script
// 3. Collez tout ce code, remplacez SHEET_NAME si besoin
// 4. Cliquez sur Déployer > Nouveau déploiement
// 5. Type : Application Web
// 6. Exécuter en tant que : Moi
// 7. Accès autorisé à : Tout le monde
// 8. Copiez l'URL générée
// 9. Collez cette URL dans index.html à la ligne SHEETS_WEBHOOK_URL
// ================================================================

const SHEET_NAME = 'Chantiers'; // Nom de l'onglet dans votre Google Sheet

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    // Créer l'onglet et les en-têtes s'il n'existe pas
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      const headers = [
        'ID Chantier', 'Statut', 'Nom Client', 'Adresse',
        'Devis', 'Consignes', 'Notes Terrain',
        'Nb Photos', 'Signature Client', 'Date Prévue', 'Date Clôture'
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#1A1A1A')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // Chercher si la ligne existe déjà (mise à jour) ou est nouvelle
    const idCol = 1;
    const lastRow = sheet.getLastRow();
    let targetRow = -1;

    if (lastRow > 1) {
      const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] === data.id) {
          targetRow = i + 2;
          break;
        }
      }
    }

    const rowData = [
      data.id || '',
      data.statut || '',
      data.client || '',
      data.adresse || '',
      data.devis || '',
      data.consignes || '',
      data.notes || '',
      data.nbPhotos || 0,
      data.signature || 'Non',
      data.date || '',
      data.dateTermine || ''
    ];

    if (targetRow > 0) {
      // Mise à jour ligne existante
      sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // Nouvelle ligne
      sheet.appendRow(rowData);
      targetRow = sheet.getLastRow();
    }

    // Colorier selon le statut
    const statutCell = sheet.getRange(targetRow, 2);
    if (data.statut === 'Terminé') {
      sheet.getRange(targetRow, 1, 1, rowData.length).setBackground('#E8F5E9');
      statutCell.setFontColor('#2E7D32');
    } else if (data.statut === 'En cours') {
      sheet.getRange(targetRow, 1, 1, rowData.length).setBackground('#E6F1FB');
      statutCell.setFontColor('#185FA5');
    } else {
      sheet.getRange(targetRow, 1, 1, rowData.length).setBackground('#FAEEDA');
      statutCell.setFontColor('#BA7517');
    }

    // Ajuster la largeur des colonnes (première fois seulement)
    if (lastRow <= 1) {
      sheet.setColumnWidth(1, 90);   // ID
      sheet.setColumnWidth(2, 100);  // Statut
      sheet.setColumnWidth(3, 160);  // Client
      sheet.setColumnWidth(4, 250);  // Adresse
      sheet.setColumnWidth(5, 180);  // Devis
      sheet.setColumnWidth(6, 300);  // Consignes
      sheet.setColumnWidth(7, 250);  // Notes
      sheet.setColumnWidth(8, 80);   // Photos
      sheet.setColumnWidth(9, 100);  // Signature
      sheet.setColumnWidth(10, 100); // Date
      sheet.setColumnWidth(11, 100); // Clôture
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, row: targetRow }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Permet de tester que le script fonctionne
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'Jardinator API opérationnelle' }))
    .setMimeType(ContentService.MimeType.JSON);
}
