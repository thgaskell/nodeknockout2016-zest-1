import menubar from 'menubar';
import electron, { ipcMain } from 'electron';

import runMocha from './lib/start';
import createPathWatcher from './lib/watch';
import {
  getProjects,
  updateProject,
  removeProject,
} from './lib/storage';

import {
  INIT_APP,
  SET_PROJECTS,
  TEST_START,
  REMOVE_PROJECT,
  PROJECT_REMOVED,
} from './src/ipc-events';

const app = electron.app;

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const installExtensions = async () => {
  if (process.env.NODE_ENV === 'development') {
    const installer = require('electron-devtools-installer'); // eslint-disable-line global-require

    const extensions = [
      'REACT_DEVELOPER_TOOLS',
      'REDUX_DEVTOOLS',
    ];
    const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
    for (const name of extensions) { // eslint-disable-line
      try {
        await installer.default(installer[name], forceDownload);
      } catch (e) {} // eslint-disable-line
    }
  }
};

// menubar
const mb = menubar({
  minWidth: 500,
  maxWidth: 500,
  minHeight: 500,
  preloadWindow: true,
  resizable: true,
  transparent: true,
});

const pathWatchers = {};
/**
 * Runs the tests for a project path
 * @param  {[type]} path [description]
 * @return {[type]}      [description]
 */
function runTest(projectPath, callback = function noop() {}) {
  mb.window.webContents.send(TEST_START, projectPath);
  return runMocha(projectPath, (err, data) => {
    callback(err, data);
    if (err) {
      return mb.window.webContents.send('test error', err, projectPath);
    }
    const payload = {
      projectPath,
      ...data,
      updatedAt: new Date(),
    };
    const persistedStats = {
      stats: data.stats,
      updatedAt: new Date(),
    };
    return updateProject(projectPath, persistedStats, (/* err */) => {
      return mb.window.webContents.send('test results', payload);
    });
  });
}

mb.on('ready', () => {
  console.log('app is ready'); // eslint-disable-line
  // your app code here

  // ====================================================================
  // This is where the data gets passed to `src/index.js`,
  // Move to a function call triggered by the frontend.
  // ====================================================================
  ipcMain.on(INIT_APP, function () {
    return getProjects((err, projects) => {
      return mb.window.webContents.send(SET_PROJECTS, projects);
    });
  });

  ipcMain.on('watch directory', (event, path) => {
    let watcher;
    let running = false;
    if (!pathWatchers[path]) {
      watcher = createPathWatcher(path, (/* filepath */) => {
        if (!running) {
          running = true;
          runTest(path, (/* err, results */) => {
            running = false;
          });
        }
      });

      pathWatchers[path] = watcher;
    }
  });

  ipcMain.on('execute test', (event, path) => {
    runTest(path);
  });

  ipcMain.on(REMOVE_PROJECT, (event, path) => {
    return removeProject(path, (err, wasRemoved) => {
      const pathWatcher = pathWatchers[path];

      if (pathWatcher) {
        pathWatcher.close();
      }

      return mb.window.webContents.send(PROJECT_REMOVED, path, wasRemoved);
    });
  });
  // ====================================================================
});

// ipc communication
ipcMain.on('quit', () => {
  for (const watcher in pathWatchers) {
    if ({}.hasOwnProperty.call(pathWatchers, watcher)) {
      pathWatchers[watcher].close();
    }
  }
  app.quit();
});
