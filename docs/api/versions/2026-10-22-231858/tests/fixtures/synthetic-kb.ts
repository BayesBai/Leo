import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Deliberately fictional data. These files exercise local parsing and rendering,
// and must never be used as product evidence outside the test process.
export const SYNTHETIC_PRODUCT_NAME = '模拟协议笔电';
export const SYNTHETIC_HARMONY_SYSTEM = 'HarmonyOS 6.1（纯模拟）';
export const SYNTHETIC_WINDOWS_SYSTEM = 'Windows 11（纯模拟）';

export async function writeSyntheticKnowledgeBase(root: string): Promise<void> {
  const models = [
    { category: '01-鸿蒙电脑', system: SYNTHETIC_HARMONY_SYSTEM, weight: '1.2 kg', screen: '14 英寸' },
    { category: '02-MateBook-Windows', system: SYNTHETIC_WINDOWS_SYSTEM, weight: '1.6 kg', screen: '15.6 英寸' },
  ];
  const colors = ['#b7c9db', '#dabaa6', '#b5cbb3', '#d0b9d5'];
  for (const model of models) {
    const folder = path.join(root, 'P1-产品参数库', model.category, SYNTHETIC_PRODUCT_NAME);
    await mkdir(path.join(folder, 'images'), { recursive: true });
    await writeFile(path.join(folder, '产品事实.md'), `# ${SYNTHETIC_PRODUCT_NAME} - 产品事实

纯模拟测试资料，不代表任何真实产品。

## 操作系统

${model.system}

## 尺寸与重量

重量
约 ${model.weight}
*实际重量依模拟配置和测量方式不同，以模拟测试条件为准。

## 屏幕

尺寸
${model.screen}
类型
LCD
分辨率
1920×1080

## 处理器

模拟处理器 A

## 内存

16 GB

## 存储

512 GB

## 电池

容量
56 Wh

## 接口

USB-C 接口

## 键盘和触控板

模拟键盘
模拟触控板
`);
    const rows = ['文件名,产品型号,官网图片说明,宽度,高度'];
    for (const [index, background] of colors.entries()) {
      const filename = `fixture-${index + 1}.png`;
      const image = await sharp({ create: { width: 320, height: 200, channels: 3, background } }).png().toBuffer();
      await writeFile(path.join(folder, 'images', filename), image);
      rows.push(`${filename},${SYNTHETIC_PRODUCT_NAME},纯模拟产品画面${index + 1},320,200`);
    }
    await writeFile(path.join(folder, '图片索引.csv'), rows.join('\n'));
  }
}
