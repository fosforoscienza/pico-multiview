// Firma "ad-hoc" dell'app prima che finisca dentro il .dmg.
//
// Perché serve: sui Mac con chip Apple un'applicazione **senza nessuna firma**
// viene rifiutata dal sistema con il messaggio "è danneggiata e non può essere
// aperta" — che non c'entra niente con il file, è solo il modo in cui macOS dice
// "questo non lo eseguo". Non avendo un certificato Apple, la firma ad-hoc è la
// cosa più vicina: non certifica chi l'ha scritta, ma rende l'app eseguibile e
// trasforma quel blocco in un normale avviso che si può accettare.
//
// electron-builder lo lancia da solo (campo "afterPack" nel package.json).

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function firmaAdHoc(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  // --deep firma anche i pezzi interni (framework di Electron, processi di
  // supporto): senza, la firma dell'involucro non basta e il sistema rifiuta.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });

  // Verifica subito: se la firma non regge è meglio saperlo qui, dove la build
  // si ferma, che scoprirlo dopo aver scaricato mezzo giga sul Mac di qualcuno.
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });

  console.log(`  • firma ad-hoc applicata e verificata  app=${path.basename(app)}`);
};
