import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function getClipboardImage(saveDir, customFilename) {
  const dir = saveDir || path.resolve(process.cwd(), 'docs', 'images');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const fname = (customFilename ? customFilename.replace(/\.[^/.]+$/, '') : `screenshot_${timestamp}`) + '.png';
  const targetPath = path.resolve(dir, fname);

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $img) {
  Write-Output "NO_IMAGE"
} else {
  $target = "${targetPath.replace(/\\/g, '\\\\')}"
  $img.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose()
  Write-Output "OK:$target"
}
`;

  try {
    const res = execFileSync('powershell', ['-NoProfile', '-STA', '-Command', psScript], {
      encoding: 'utf-8',
      timeout: 10000
    }).trim();

    if (res.startsWith('OK:')) {
      const savedPath = res.substring(3).trim();
      const base64Data = fs.readFileSync(savedPath).toString('base64');
      return {
        success: true,
        path: savedPath,
        base64: base64Data
      };
    } else {
      return { success: false, message: 'Windows 剪贴板中当前没有检测到位图图像，请先按 Win+Shift+S 进行截图。' };
    }
  } catch (err) {
    return { success: false, message: '读取剪贴板异常: ' + (err.message || String(err)) };
  }
}

function getClipboardText() {
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::GetText()
`;
  try {
    const text = execFileSync('powershell', ['-NoProfile', '-STA', '-Command', psScript], {
      encoding: 'utf-8',
      timeout: 5000
    });
    return text.trim();
  } catch (err) {
    return '';
  }
}

rl.on('line', (line) => {
  const raw = line.trim();
  if (!raw) return;

  let req;
  try {
    req = JSON.parse(raw);
  } catch {
    return;
  }

  const { id, method, params } = req;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'windows-clipboard-mcp',
          version: '1.0.0'
        }
      }
    });
    return;
  }

  if (method === 'notifications/initialized') {
    return;
  }

  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'read_clipboard_image',
            description: '从 Windows 剪贴板读取最新截图，保存为 PNG 图片，并返回文件路径和图像数据供大模型分析。',
            inputSchema: {
              type: 'object',
              properties: {
                save_dir: {
                  type: 'string',
                  description: '可选：指定保存的文件夹路径'
                },
                filename: {
                  type: 'string',
                  description: '可选：保存的文件名（如 webui 或 banner）'
                }
              }
            }
          },
          {
            name: 'read_clipboard_text',
            description: '读取 Windows 剪贴板中的纯文本内容。',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      }
    });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === 'read_clipboard_image') {
      const res = getClipboardImage(args.save_dir, args.filename);
      if (res.success) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `已成功从剪贴板保存图片至: ${res.path}`
              },
              {
                type: 'image',
                data: res.base64,
                mimeType: 'image/png'
              }
            ]
          }
        });
      } else {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: res.message
              }
            ],
            isError: true
          }
        });
      }
      return;
    }

    if (toolName === 'read_clipboard_text') {
      const text = getClipboardText();
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: text ? `剪贴板文本：\n${text}` : '当前剪贴板中无文本。'
            }
          ]
        }
      });
      return;
    }

    send({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Unknown tool: ${toolName}`
      }
    });
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Unhandled method: ${method}`
      }
    });
  }
});
