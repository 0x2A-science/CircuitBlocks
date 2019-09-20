import * as SerialPort from 'serialport';
import * as childProcess from 'child_process';
import * as grpc from 'grpc';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as yaml from "js-yaml";

import { BuilderClient } from '../proto/builder_grpc_pb';
import { BuildParams } from '../proto/builder_pb';
import Serial from './serial';

export interface PortDescriptor {
  manufacturer: string;
  serialNumber: string;
  pnpId: string;
  locationId: string;
  vendorId: string;
  productId: string;
  comName: string;
}

export interface InstallInfo {
  arduino: string | null,
  cli: string | null,

  sketchbook: string | null,
  local: string | null
}

export default class ArduinoCompiler {
  private static client = new BuilderClient('localhost:12345', grpc.credentials.createInsecure());
  private static process: childProcess.ChildProcess;

  private static readonly CB_TMP: string = path.join(os.tmpdir(), 'circuitblocks');
  private static ARDUINO_INSTALL: string = '';
  private static ARDUINO_HOME: string = '';
  private static ARDUINO_LOCAL: string = '';

  private static serial: Serial;
  private static installInfo: InstallInfo;

  public static getDirectories(){
    return {
      install: this.ARDUINO_INSTALL,
      home: this.ARDUINO_HOME,
      local: this.ARDUINO_LOCAL
    };
  }

  public static getSerial(){
    if(this.serial == undefined){
      this.serial = new Serial();
    }

    return this.serial;
  }

  /**
   * Sets the relevant Arduino directories.
   * @param install Arduino install directory. Contains directories "hardware", "tools", "tools-builder", etc.
   * @param home Arduino home directory. Usually in the user's My Documents. Usually contains directories "libraries"
   * @param local Arduino local directory
   * and "sketches".
   */
  public static setup(install: string, home: string, local: string) {
    this.ARDUINO_INSTALL = install;
    this.ARDUINO_HOME = home;
    this.ARDUINO_LOCAL = local;
  }

  public static checkInstall(): InstallInfo | null {
    let local: string;

    if(os.type() === "Windows_NT"){
      local = path.join(os.homedir(), "AppData", "Local", "Arduino15");

      if(!fs.existsSync(local)){
        local = path.join(os.homedir(), "AppData", "Roaming", "Arduino15");
      }
    }else if(os.type() === "Linux"){
      local = path.join(os.homedir(), ".arduino15");
    }else if(os.type() === "Darwin"){
      local = path.join(os.homedir(), "Library", "Arduino15");
    }else{
      return null;
    }

    if(!fs.existsSync(local)){
      return null;
    }

    let info: InstallInfo = { arduino: null, cli: null, sketchbook: null, local: local };

    const prefPath = path.join(local, "preferences.txt");
    const configPath = path.join(local, "arduino-cli.yaml");

    if(fs.existsSync(prefPath)){
      const preferences = this.parsePreferences(prefPath);

      if(preferences != null){
        info.arduino = preferences.arduino;
        info.sketchbook = preferences.sketchbook;
      }
    }

    if(fs.existsSync(configPath)){
      const config = yaml.safeLoad(fs.readFileSync(configPath));

      info.local = config.arduino_data;
      info.sketchbook = config.sketchbook_path;
    }

    const installPath = path.join(local, "..", os.type() == "Windows_NT" ? "Arduino" : ".arduino");

    if(!fs.existsSync(installPath)){
      return info;
    }

    const cliPath = path.join(installPath, "arduino-cli" + (os.type() == "Windows_NT" ? ".exe" : ""));
    if(fs.existsSync(cliPath)){
      info.cli = installPath;
    }

    if(info.arduino == null){
      let install: { version: string, path: string } | null = null;

      fs.readdirSync(installPath).forEach(file => {
        const arduinoPath = path.join(installPath, file);
        if(!fs.statSync(arduinoPath).isDirectory()) return;
        if(!file.startsWith("arduino-")) return;
        const version = file.substring(8);

        if(install == null || this.isNewer(version, install.version)){
          install = { version, path: arduinoPath };
        }
      });

      info.arduino = install.path;
    }

    this.installInfo = info;
    return info;
  }

  private static parsePreferences(prefPath): { arduino: string, sketchbook: string } | null {
    const preferences = fs.readFileSync(prefPath).toString().split(os.EOL);

    let home: string = "";
    const installs: any = {};
    preferences.forEach(line => {
      const parts = line.split("=");
      const prop = parts[0];
      const val = parts[1];

      if(prop === "sketchbook.path"){
        home = val;
      }else if(prop.startsWith("last.ide") && prop.endsWith(".hardwarepath")){
        let version = prop.substring(9, prop.length - 13);
        installs[version] = val.substring(0, val.length - 9);
      }
    });

    if(installs === {}) return null;
    const versions = Object.keys(installs);
    let newest = versions[0];
    for(let i = 1; i < versions.length; i++){
      if(this.isNewer(versions[i], newest)) newest = versions[i];
    }

    return { arduino: installs[newest], sketchbook: home };
  }

  private static isNewer(newer: string, older: string): boolean {
    const partsNewer = newer.split(".");
    const partsOlder = newer.split(".");

    for(let i = 0; i < partsNewer.length; i++){
      if(parseInt(partsNewer[i]) > parseInt(partsOlder[i])) return true;
    }

    return false;
  }

  /**
   * Starts the builder daemon. Rejects if the builder couldn't be found or paths haven't been set up.
   */
  public static startDaemon(): Promise<null> {
    return new Promise<null>((resolve, reject) => {
      if (this.ARDUINO_LOCAL === '') {
        reject(new Error('Pahts not set up'));
        return;
      }

      let builderPath = path.join(this.ARDUINO_INSTALL, 'arduino-builder');
      if(os.type() == "Windows_NT") builderPath += ".exe";

      if (!fs.existsSync(builderPath)) {
        reject(new Error('Builder not found'));
        return;
      }

      this.process = childProcess.execFile(builderPath, ['--daemon']);

      resolve();
    });
  }

  /**
   * Stops the builder daemon.
   */
  public static stopDaemon() {
    this.process.kill();
  }

  /**
   * Retrieves the possible MAKERphone ports.
   * @param thirdParty accept any usb to serial
   */
  public static identifyPort(thirdParty: boolean = false): Promise<PortDescriptor[]> {
    return new Promise<any>((resolve, _reject) => {
      SerialPort.list((err, ports) => {
        resolve(
          ports.filter((port) =>
            thirdParty
              ? port.vendorId && port.productId
              : port.vendorId === '10c4' && port.productId === 'ea60'
          )
        );
      });
    });
  }

  /**
   * Compiles the specified Arduino C code. See {@link compileSketch} for details on returned promise
   * @see compileSketch
   * @param code Arduino C code
   */
  public static compile(code: string): Promise<{ binary: string; status: string[] }> {
    const sketchDir = path.join(this.CB_TMP, 'sketch');
    const sketchPath = path.join(sketchDir, 'sketch.ino');
    if (!fs.existsSync(sketchDir)) fs.mkdirSync(sketchDir, { recursive: true });
    fs.writeFileSync(sketchPath, code);

    return this.compileSketch(sketchPath);
  }

  /**
   * Compiles the specified Arduino sketch.
   *
   * Returns a promise. On success, resolves with the following object:
   * { binary: path to the compiled binary, status: array of status strings returned by the compiler }
   *
   * On error rejects with the following object:
   * { message: a short error message, error: the error object returned by the compiler }
   *
   * On compilation error, the rejected object will have code 2. On resolution and rejection due to compiler errors,
   * the returned object will have the property 'output' which is an array of strings outputted by the copiler.
   *
   * @param sketchPath Absolute path to the sketch to be compiled.
   */
  public static compileSketch(sketchPath: string): Promise<{ binary: string; status: string[], output: string[] }> {
    const sketchName = path.parse(sketchPath).base;
    const compiledPath: string = path.join(this.CB_TMP, 'build', sketchName + '.bin');

    return new Promise((resolve, reject) => {
      if (this.ARDUINO_LOCAL === '')
        reject(new Error('Arduino directories not set up. Run the setup method first'));

      const stream = this.client.build(this.buildParams(sketchPath), (err, _response) => {
        if (err) reject(err);
      });

      const status: string[] = [];
      const output: string[] = [];
      let fulfilled = false;
      let error: any;

      this.process.stderr.on('data', (data) => {
        output.push(data);
      });

      stream.on('error', (data) => {
        error = data;
      });

      stream.on('data', (data) => {
        status.push(data.array);
      });

      stream.on('end', () => {
        if (fulfilled) return;
        fulfilled = true;

        error.output = output;
        reject(error);
      });

      stream.on('status', (data) => {
        fulfilled = true;

        if (data.code === 0) {
          resolve({ binary: compiledPath, status, output });
        } else {
          error.output = output;
          reject(error);
        }
      });
    });
  }

  private static buildParams(sketchPath: string): BuildParams {
    const buildParams: BuildParams = new BuildParams();

    const CM_LOCAL: string = path.join(this.ARDUINO_LOCAL, 'packages', 'cm');

    buildParams.setSketchlocation(sketchPath);
    buildParams.setBuildpath(path.join(this.CB_TMP, 'build'));
    buildParams.setBuildcachepath(path.join(this.CB_TMP, 'cache'));

    buildParams.setHardwarefolders(
      [path.join(this.ARDUINO_INSTALL, 'hardware'), path.join(this.ARDUINO_LOCAL, 'packages')].join(
        ','
      )
    );

    buildParams.setToolsfolders(
      [
        path.join(this.ARDUINO_INSTALL, 'tools-builder'),
        path.join(this.ARDUINO_INSTALL, 'hardware', 'tools', 'avr'),
        path.join(this.ARDUINO_LOCAL, 'packages')
      ].join(',')
    );

    buildParams.setBuiltinlibrariesfolders(path.join(this.ARDUINO_INSTALL, 'libraries'));
    buildParams.setOtherlibrariesfolders(path.join(this.ARDUINO_HOME, 'libraries'));

    buildParams.setCustombuildproperties(
      [
        'runtime.tools.mkspiffs.path=' + path.join(CM_LOCAL, 'tools', 'mkdpiffs', '0.2.3'),
        'runtime.tools.mkspiffs-0.2.3.path=' + path.join(CM_LOCAL, 'tools', 'mkdpiffs', '0.2.3'),
        'runtime.tools.xtensa-esp32-elf-gcc.path=' +
          path.join(CM_LOCAL, 'tools', 'xtensa-esp32-elf-gcc', '1.22.0-80-g6c4433a-5.2.0'),
        'runtime.tools.xtensa-esp32-elf-gcc-1.22.0-80-g6c4433a-5.2.0.path=' +
          path.join(CM_LOCAL, 'tools', 'xtensa-esp32-elf-gcc', '1.22.0-80-g6c4433a-5.2.0'),
        'runtime.tools.esptool_py.path=' + path.join(CM_LOCAL, 'tools', 'esptool_py', '2.6.1'),
        'runtime.tools.esptool_py-2.6.1.path=' + path.join(CM_LOCAL, 'tools', 'esptool_py', '2.6.1')
      ].join(',')
    );
    buildParams.setArduinoapiversion('10809');
    buildParams.setFqbn(
      'cm:esp32:ringo:PartitionScheme=min_spiffs,FlashFreq=80,UploadSpeed=921600,DebugLevel=none'
    );

    return buildParams;
  }
}
