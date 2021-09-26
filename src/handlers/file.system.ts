import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = './results';


export async function readFileData(fileName: string): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR);
    }
    const file = path.join(OUTPUT_DIR, `${fileName}.json`);

    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${fileName}.json`),
        '[]',
        'utf-8'
      );
    }

    const data = fs.readFileSync(file, 'utf8');
    // parse tx object and add to file
    const parsed = JSON.parse(data);
    resolve(parsed);
  });
}
export async function writeDataToFile(
  fullData: [],
  transaction: any,
  fileName: string
) {
  return new Promise((resolve, reject) => {
    const file = path.join(OUTPUT_DIR, `${fileName}.json`);
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR);
    }
    fs.writeFileSync(file, JSON.stringify(fullData));
    resolve('saved');
  });
}

export async function appendToFile(fileName: string, tx: any) {
  // read file contents
  const fileContents = await readFileData(fileName);
  // add data to file
  fileContents.push(tx);
  // write data if enabled
  await writeDataToFile(fileContents, tx, fileName);
}
