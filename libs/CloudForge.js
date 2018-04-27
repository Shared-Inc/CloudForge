/*
 * Dependencies
 */

const fs = require('fs');
const path = require('path');
const promisify = require('util.promisify');
const aws = require('aws-sdk');
const directoryTree = require('directory-tree');
const dot = require('dot');
const Joi = require('joi');
const liveServer = require('live-server');
const mkdirp = require('mkdirp');
const ncp = promisify(require('ncp'));
const replace = require('replace');
const rimraf = promisify(require('rimraf'));
const s3Helper = require('s3');
const sass = require('node-sass');
const watch = require('node-watch');

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
      awsAccessKeyId: Joi.string().allow('').optional(),
      awsSecretAccessKey: Joi.string().allow('').optional(),
      awsRegion: Joi.string().allow('').optional(),
      awsS3Bucket: Joi.string().allow('').optional(),
      awsCloudFrontDistributionId: Joi.string().allow('').optional(),
      deployDirectory: Joi.string().allow('').optional(),
      server: Joi.object({
        directory: Joi.string().required(),
        browser: Joi.string().required(),
        port: Joi.number().required(),
        watchDirectories: Joi.array().items(Joi.string()).optional(),
      }).optional(),
      html: Joi.object({
        sourceDirectory: Joi.string().required(),
        buildDirectory: Joi.string().required(),
        copyFilesWithExtensions: Joi.array().items(Joi.string()).optional(),
        componentsDirectory: Joi.string().allow('').optional(),
        templateDependencies: Joi.object().optional(),
      }).optional(),
      sass: Joi.object({
        sourceDirectory: Joi.string().required(),
        buildDirectory: Joi.string().required(),
        includeSourceMap: Joi.boolean().optional(),
        outputStyle: Joi.string().valid('nested', 'expanded', 'compact', 'compressed').optional(),
      }).optional(),
      cleanIgnoreDirectories: Joi.array().items(Joi.string()).optional(),
      dependencies: Joi.array().items(Joi.array().items(Joi.string(), Joi.array()).min(2).max(3)).optional(),
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

    this._getDirectories('build').forEach(directory => {
      if (!this.cleanIgnoreDirectories || !this.cleanIgnoreDirectories.includes(directory)) {
        promises.push(rimraf(directory));
      }
    });

    return Promise.all(promises).then(() => {
      cloudForgeLog('Cleaned the build directories successfully!');
    });
  }

  /*
   * compileHtml()
   * --
   * Recurses file and directories in this.html.sourceDirectory
   * and renders all files, templates and
   * components into their respective files
   * in this.html.buildDirectory.
   * --
   * Returns a promise.
   */

  compileHtml() {
    cloudForgeLog('Compiling HTML...');

    if (!this.html) {
      return Promise.reject('Could not compile HTML! The html property has not been set!');
    }

    let templates = {};

    const recurse = directory => {
      const directoryPath = path.normalize(directory.path);

      // Get template for current working directory, if any.
      directory.children.forEach(child => {
        if (child.name === 'template.html.dot') {
          templates[directoryPath] = dot.template(fs.readFileSync(child.path).toString());
        }
      });

      // Select correct parent template.
      let parentTemplateKey = directoryPath;
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
        const sourceDirectory = path.normalize(this.html.sourceDirectory);
        const writePath = path.join(this.html.buildDirectory, child.path.replace(sourceDirectory, ''));

        if (child.type !== 'directory') {
          if (child.extension === '.html') {
            const childTemplate = dot.template(fs.readFileSync(child.path));
            const metadataPath = path.join(directoryPath, 'metadata.json');
            const metadata = (fs.existsSync(metadataPath)) ? JSON.parse(fs.readFileSync(metadataPath).toString()) : {};
            const templateDependencies = Object.assign({
              metadata,
              getComponent,
            }, this.html.templateDependencies);

            mkdirp.sync(path.dirname(writePath));

            fs.writeFileSync(writePath, parentTemplate(Object.assign({
              content: childTemplate(templateDependencies),
            }, templateDependencies)));
          }

          if (this.html.copyFilesWithExtensions && this.html.copyFilesWithExtensions.includes(child.extension)) {
            mkdirp.sync(path.dirname(writePath));
            fs.writeFileSync(writePath, fs.readFileSync(child.path));
          }
        } else {
          recurse(child);
        }
      });
    };

    // Recursively compile.
    return new Promise((resolve, reject) => {
      try {
        recurse(directoryTree(this.html.sourceDirectory, {
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
   * this.sass.sourceDirectory and renders all .sass
   * and .scss files into their respective
   * build files in this.sass.buildDirectory.
   * --
   * Returns a promise.
   */

  compileSass() {
    cloudForgeLog('Compiling Sass...');

    if (!this.sass) {
      return Promise.reject('Could not compile Sass! The sass property has not been set!');
    }

    const recurse = directory => {
      // Recurse & compile Sass files.
      directory.children.forEach(child => {
        if (child.name.charAt(0) !== '_' && (child.extension === '.sass' || child.extension === '.scss')) {
          const sourceDirectoy = path.normalize(this.sass.sourceDirectory);
          const writePath = path.join(this.sass.buildDirectory, child.path.replace(sourceDirectoy, '')).slice(0, -5) + '.css';
          const result = sass.renderSync({
            file: child.path,
            outFile: writePath.replace(this.sass.buildDirectory, ''),
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
        recurse(directoryTree(this.sass.sourceDirectory, {
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
      return Promise.reject('Could not copy dependencies! The dependencies property has not been set!');
    }

    let promises = [];

    this.dependencies.forEach(instructions => {
      const sourceDirectory = instructions[0];
      const buildDirectory = instructions[1];
      const replacements = instructions[2];

      mkdirp.sync(path.dirname(buildDirectory));

      promises.push(ncp(sourceDirectory, buildDirectory).then(() => {
        if (!Array.isArray(replacements)) {
          return;
        }

        replacements.forEach(replacement => {
          replace({
            regex: replacement[0],
            replacement: replacement[1],
            paths: [buildDirectory],
            recursive: true,
            silent: true,
          });
        });
      }));
    });

    return Promise.all(promises).then(() => {
      cloudForgeLog('Copied dependencies successfully!');
    });
  }

  /*
   * deploy()
   * --
   * Runs build(), then uploads all contents
   * of the build directories to the specified
   * S3 bucket specified with awsS3Bucket.
   * If awsCloudFrontDistributionId was provided,
   * all objects of it will be invalidated after
   * uploading to S3.
   * --
   * Returns a promise.
   */

  deploy() {
    cloudForgeLog('Deploying to S3...');

    if (!this.awsAccessKeyId || !this.awsSecretAccessKey || !this.awsRegion || !this.awsS3Bucket) {
      return Promise.reject('Could not deploy! The awsAccessKeyId, awsSecretAccessKey, awsRegion or awsS3Bucket has not been set!');
    }

    this.build().then(() => {
      return new Promise((resolve, reject) => {
        const awsCredentials = {
          accessKeyId: this.awsAccessKeyId,
          secretAccessKey: this.awsSecretAccessKey,
          region: this.awsRegion,
        };

        const s3Uploader = s3Helper.createClient({
          s3Options: awsCredentials,
        }).uploadDir({
          localDir: this.deployDirectory,
          deleteRemoved: true,
          s3Params: {
            Bucket: this.awsS3Bucket,
            ACL: 'public-read',
          },
        });

        s3Uploader.on('error', error => {
          reject(error);
        });

        s3Uploader.on('end', () => {
          cloudForgeLog('Deployed to S3 successfully!');

          if (!this.awsCloudFrontDistributionId) {
            return resolve();
          }

          cloudForgeLog('Creating CloudFront invalidation...');

          aws.config = new aws.Config(awsCredentials);

          const cloudFront = new aws.CloudFront();

          cloudFront.createInvalidation({
            DistributionId: this.awsCloudFrontDistributionId,
            InvalidationBatch: {
              CallerReference: Date.now().toString(),
              Paths: {
                Quantity: 1,
                Items: [
                  '/*',
                ],
              },
            },
          }).promise().then(() => {
            cloudForgeLog('Created CloudFront invalidation successfully!');
            resolve();
          }).catch(reject);
        });
      });
    });
  }

  /*
   * develop()
   * --
   * Runs build(), then initializes a server running
   * on localhost using the port specified in server.port.
   * It then launches a browser window that loads
   * the content the server is serving from the specified
   * directory set in server.directory.
   * --
   * Returns nothing. Runs indefinitely until script termination.
   */

  develop() {
    cloudForgeLog('Starting server...');

    if (!this.server || !this.html) {
      return Promise.reject('Could not serve! The develop or html property has not been set!');
    }

    this.build().then(() => {
      let watchDirectories = this._getDirectories('source');

      if (this.server.watchDirectories) {
        watchDirectories = watchDirectories.concat(this.server.watchDirectories);
      }

      if (this.html.componentsDirectory) {
        watchDirectories.push(this.html.componentsDirectory);
      }

      watch(watchDirectories, { recursive: true }, () => {
        console.log('---');
        cloudForgeLog('Changes found...');

        this.build().then(() => {
          cloudForgeLog('Refreshing browser!');
          cloudForgeLog('Waiting for changes...');
        });
      });

      liveServer.start({
        browser: this.server.browser,
        host: 'localhost',
        port: this.server.port,
        root: this.server.directory,
        wait: 1250,
        ignore: '.git',
      });

      liveServer.logLevel = 0;

      cloudForgeLog('Server started. Waiting for changes...');
    });
  }

  _getDirectories(type) {
    let directories = [];

    if (this.html) {
      directories.push(this.html[`${type}Directory`]);
    }

    if (this.sass) {
      directories.push(this.sass[`${type}Directory`]);
    }

    if (this.dependencies) {
      const directoryIndex = (type === 'build') ? 1 : 0;

      this.dependencies.forEach(instructions => {
        directories.push(instructions[directoryIndex]);
      });
    }

    return directories;
  }
}

/*
 * Helpers
 */

function cloudForgeLog(message) {
  console.log(`CloudForge: ${message}`);
}

function getComponent(path, object) {
  const template = dot.template(fs.readFileSync(path).toString());

  object = object || {};

  return template(Object.assign(object, { getComponent }));
}

/*
 * Export
 */

module.exports = CloudForge;
