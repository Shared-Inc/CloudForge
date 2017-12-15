/*
 * Dependencies
 */

const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const promisify = require('util.promisify');
const directoryTree = require('directory-tree');
const sass = require('node-sass');
const mkdirp = require('mkdirp');
const ncp = promisify(require('ncp'));
const dot = require('dot');
const rimraf = promisify(require('rimraf'));

/*
 * Set templating engine format
 */

dot.templateSettings['evaluate'] = /\<\{([\s\S]+?)\}\>/g;
dot.templateSettings['interpolate'] = /\<\{=([\s\S]+?)\}\>/g;
dot.templateSettings['encode'] = /\<\{!([\s\S]+?)\}\>/g;
dot.templateSettings['use'] = /\<\{#([\s\S]+?)\}\>/g;
dot.templateSettings['define'] = /\<\{##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\}\>/g;
dot.templateSettings['conditional'] = /\<\{\?(\?)?\s*([\s\S]*?)\s*\}\>/g;
dot.templateSettings['iterate'] = /\<\{~\s*(?:\}\>|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\}\>)/g;
dot.templateSettings['strip'] = false;

/*
 * CloudForge
 */

class CloudForge {
  constructor(options) {
    Joi.assert(options, Joi.object({
      awsAccessKeyId: Joi.string().optional(),
      awsSecretAccessKey: Joi.string().optional(),
      awsS3Bucket: Joi.string().optional(),
      awsCloudFrontDistributionId: Joi.string().optional(),
      html: Joi.object({
        srcPath: Joi.string().required(),
        buildPath: Joi.string().required(),
        components: Joi.object().optional(),
        componentDependencies: Joi.object().optional(),
        outputStyle: Joi.string().valid('nested', 'expanded', 'compact', 'compressed').optional(),
      }).required(),
      sass: Joi.object({
        srcPath: Joi.string().required(),
        buildPath: Joi.string().required(),
        includeSourceMap: Joi.boolean().optional(),
      }), // [ [srcPath, buildPath] ]
      dependencies: Joi.array().items(Joi.array().items(Joi.string()).min(2).max(2)).optional(), // [ [srcPath, buildPath, includeMap] ]
    }));

    Object.assign(this, options);
  }

  /*
   * build()
   * --
   * Cleans the build directory and then
   * compiles HTML & Sass, and copies any
   * specified dependencies to their target
   * directories.
   * --
   * Returns a promise.
   */

  build() {
    cloudForgeLog('Building...');

    return this.clean().then(() => {
      return this.compileHtml();
    }).then(() => {
      return this.compileSass();
    }).then(() => {
      return this.copyDependencies();
    }).then(() => {
      cloudForgeLog('Built successfully!');
    });
  }

  clean() {
    cloudForgeLog('Cleaning the build directories...');

    let promises = [];

    promises.push(rimraf(this.html.buildPath));

    if (this.sass) {
      promises.push(rimraf(this.sass.buildPath));
    }

    if (this.dependencies) {
      this.dependencies.forEach(instructions => {
        promises.push(rimraf(instructions[1]));
      });
    }

    return Promise.all(promises).then(() => {
      cloudForgeLog('Cleaned the build directories successfully!');
    });
  }

  /*
   * compileHtml()
   * --
   * Recurses file and directories in this.html.srcPath
   * and renders all files, templates and
   * components into their respective files
   * in this.html.buildPath.
   * --
   * Returns a promise.
   */

  compileHtml() {
    cloudForgeLog('Compiling HTML...');

    let templates = {};

    const recurse = directory => {
      // Store template for current working directory.
      directory.children.forEach(child => {
        if (child.extension === '.dot') {
          templates[directory.path] = dot.template(fs.readFileSync(child.path).toString());
        }
      });

      // Select correct parent template.
      let parentTemplateKey = directory.path;
      let parentTemplate = null;

      while (!parentTemplate) {
        if (!parentTemplateKey) {
          break;
        }

        parentTemplate = templates[parentTemplateKey];
        parentTemplateKey = parentTemplateKey.split('/');
        parentTemplateKey.pop();
        parentTemplateKey = parentTemplateKey.join('/');
      }

      // Compile HTML files.
      directory.children.forEach(child => {
        if (child.extension === '.html') {
          const writePath = path.join(this.html.buildPath, child.path.replace(this.html.srcPath, ''));
          const metadataPath = path.join(directory.path, 'metadata.json');
          const childTemplate = dot.template(fs.readFileSync(child.path));
          const packagedComponents = Object.assign({
            components: this.html.components,
            metadata: (fs.existsSync(metadataPath)) ? JSON.parse(fs.readFileSync(metadataPath).toString()) : {},
          }, this.html.componentDependencies);

          mkdirp.sync(path.dirname(writePath));

          fs.writeFileSync(writePath, parentTemplate(Object.assign({
            content: childTemplate(packagedComponents),
          }, packagedComponents)));
        }

        if (child.type === 'directory') {
          recurse(child);
        }
      });
    };

    // Recursively compile.
    return new Promise((resolve, reject) => {
      try {
        recurse(directoryTree(this.html.srcPath, {
          exclude: /.DS_Store/,
        }));
      } catch(error) {
        reject(error);
      }

      resolve();
    }).then(() => {
      cloudForgeLog('Compiled HTML successfully!');
    });
  }

  /*
   * compileSass()
   * --
   * Recurses files and directories in
   * this.sass.srcPath and renders all .sass
   * and .scss files into their respective
   * build files in this.sass.buildPath.
   * --
   * Returns a promise.
   */

  compileSass() {
    cloudForgeLog('Compiling Sass...');

    const recurse = directory => {
      // Recurse & compile Sass files.
      directory.children.forEach(child => {
        if (child.name.charAt(0) !== '_' && (child.extension === '.sass' || child.extension === '.scss')) {
          const writePath = path.join(this.sass.buildPath, child.path.replace(this.sass.srcPath, '')).slice(0, -5) + '.css';
          const result = sass.renderSync({
            file: child.path,
            outFile: writePath.replace(this.sass.buildPath, ''),
            sourceMap: this.sass.includeSourceMap || false,
            outputStyle: this.sass.outputStyle || 'nested',
          });

          mkdirp.sync(path.dirname(writePath));

          fs.writeFileSync(writePath, result.css);

          if (result.map) {
            fs.writeFileSync(`${writePath}.map`, result.map);
          }
        }

        if (child.type === 'directory') {
          recurse(child);
        }
      });
    };

    return new Promise((resolve, reject) => {
      try {
        recurse(directoryTree(this.sass.srcPath, {
          exclude: /.DS_Store/,
        }));
      } catch (error) {
        reject(error);
      }

      resolve();
    }).then(() => {
      cloudForgeLog('Compiled Sass successfully!');
    });
  }

  /*
   * copyDependencies()
   * --
   * Copies all dependencies in the path specified
   * in the first index of each array in
   * this.dependencies to the associated path
   * in the second index of each array.
   * --
   * Returns a promise.
   */

  copyDependencies() {
    cloudForgeLog('Copying Dependencies...');

    if (!this.dependencies) {
      return;
    }

    let promises = [];

    this.dependencies.forEach(instructions => {
      const srcPath = instructions[0];
      const buildPath = instructions[1];

      mkdirp.sync(path.dirname(buildPath));
      promises.push(ncp(srcPath, buildPath));
    });

    return Promise.all(promises).then(() => {
      cloudForgeLog('Copied dependencies successfully!');
    });
  }

  /*
   * deploy()
   * --
   * TODO:
   * --
   * Returns a promise.
   */

  deploy() {

  }
}

/*
 * Helpers
 */

function cloudForgeLog(message) {
  console.log(`CloudForge: ${message}`);
}

/*
 * Export
 */

module.exports = CloudForge;
