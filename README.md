<p align="center">
  <img alt="CloudForge" src="https://raw.githubusercontent.com/Fanapptic/cloudforge/master/branding/logo.png" width="400" />
</p>

CloudForge is a super simple, lightweight HTML templating engine built on doT.js with reusable component support, build output minification and lightning fast Sass compilation. It also provides tools to quickly deploy your website to AWS' S3 and CloudFront.

CloudForge is supported and maintained by <a href="https://www.fanapptic.com" target="_blank">Fanapptic</a>.

## Installation

This is a <a href="https://nodejs.org/en/">Node.js</a> module available through the <a href="https://www.npmjs.com/">npm registry</a>.

Before install, <a href="https://nodejs.org/en/download/">download and install Node.js</a>. The latest stable version of Node.js is recommended.

```
npm install cloudforge
```

## Features

  * Easily reuse markup across HTML files with CloudForge components.
  * Built on the lightning fast doT.js templating engine.
  * Sass compilation using the fastest available compiler - LibSass.
  * Rapidly deploy your HTML, CSS and other dependency files to an S3 bucket, and easily invalidate all objects for a CloudFront distribution.
  * Develop quickly with built in live-server and directory watch support with auto browser refresh support when any changes are made.

## Usage
```javascript
const CloudForge = require('cloudforge');

const cloudForge = new CloudForge({
  awsAccessKeyId: 'myawskey', // Required if running deploy()
  awsSecretAccessKey: 'myawssecret', // Required if running deploy()
  awsS3Bucket: 'my-websites-bucket', // Required if running deploy()
  awsCloudFrontDistributionId: 'somedistributionid', // Required if running deploy()
  html: { // Required only if running build, deploy or compileHtml()
    sourceDirectory: './src/dir',
    buildDirectory: './build',
    componentsPath: './components', 
    componentDependencies: {
      a: { /* some object or instance available  */ },
      b: true,
      c: 'something'
    }
  },
  sass: { // Required only if running build(), deploy() or compileSass()
    sourceDirectory: './src/sass',
    buildDirectory: './build/css'
    includeSourceMap: true,
    outputStyle: 'compressed'
  }
  dependencies: [ // Required only if running build(), deploy() or copyDependencies()
    ['./some/src/path', './some/build/path'],
    ['../some/other/path', './to/this/path'],
    // More sources to copy to destinations...
  ]
});

// Then magic...

cloudForge.deploy().then(() => { // All CloudForge methods return promises.
  console.log('Successfully compiled HTML, Sass, Dependencies & deployed to S3 & created CloudFront invalidation!');
});

// OR

cloudForge.compileHtml(); // Maybe we just want out build directory to have compiled HTML for debugging and nothing else.

// OR

cloudForge.compileSass(); // Want to just compile Sass? No problem!

// See below for a full list of available methods.

```
## CloudForge class

The CloudForge class has a handful of options you can include when constructing an instance depending on what you're trying to accomplish.

### awsAccessKeyId
  * Type: `String`
  * Default: `null`

Required only for authentication if deploying to S3 / invalidating objects of a CloudFront distribution.

### awsSecretAccessKey
  * Type: `String`
  * Default: `null`
 
Required only for authentication if deploying to S3 / invalidating a objects of a CloudFront distribution.

### awsS3Bucket
  * Type: `String`
  * Default `null`

This is the S3 bucket your build directories will be deployed to. Required only if deploying.

### awsCloudFrontDistributionId
  * Type: `String`
  * Default `null`
  
The CloudFront distribution id you want to invalidate in the last step of deploying. Required only if deploying.

### html
  * Type: `Object`
  * Default `{}`
  
This is the configuration object used when compiling your HTML. It is only required if you're using compileHtml() or deploy(). It accepts the following properties.

  * **sourceDirectory**: `String` - The path to the root directory containing all of your HTML source files.
  * **buildDirectory**: `String` - The path compiled HTML files will be written to. It's structure will match that of your src directory.
  * **componentsDirectory**: `String` - The path to the directory containing your component files.
  * **templateDependencies**: `Object` - An object containing any properties and values that you want made available to all templates, renderable HTML files and components.
  
### sass
  * Type: `Object`
  * Default `{}`
  
This is the configuration object used when compiling your Sass. It is only required if you're using compileSass() or deploy(). It accepts the following properties.

  * **sourceDirectory**: `String` - The path to the root directory containing all of your Sass 
  * **buildDirectory**: `String` - The path compiled css files will be written to. It's structure will match that of your sourceDirectory.
  * **includeSourceMap**: `Boolean` - Set to `true` if you want source maps to be generated with your css files. Defaults to `false`.
  * **outputStyle**: `String` - Set to one of the available Sass output styles: `nested`, `expanded`, `compact`, `compressed`. You can <a href="https://web-design-weekly.com/2014/06/15/different-sass-output-styles/" target="_blank">learn more here</a>.
  
### dependencies
  * Type: `Array`
  * Default `[]`
  
This is an array containing arrays of 2 strings each. Each array in this array instructs a source directory to copy into a destination (build) directory. The first string of these arrays is the source directory and the second is the destination directory. It is only required if you're using copyDependencies() or deploy().

## CloudForge instance methods

The following instance methods are available.

### clean()

This deletes all build output directories specified in the `html`, `sass` and `dependencies` constructor options.

### compileHtml()

This compiles HTML from the sourceDirectory to the buildDirectory specified in the `html` constructor option.

### compileSass()

This compiles Sass to CSS from the sourceDirectory to the buildDirectory specified in the `sass` constructor option.

### copyDependencies()

This copies files from the sourceDirectory to the buildDirectory of each array entry in the `dependencies` constructor option array.

### deploy()

This runs `clean()`, `compileHtml()`, `compileSass()`, `copyDependencies()` and then uploads the content of your build directories to the S3 bucket specified. It then creates a CloudFront invalidation if `awsCloudFrontDistributionId` was provided as a constructor option. 

## Using Templating & Templates

If you've used <a href="http://olado.github.io/doT/index.html">doT.js</a> before, CloudForge templates are exactly the same except with **one caveat**, the syntax is slightly different.

In doT.js templating, all templates are surrounded by `{{ }}`. However, in CloudForge templates, you use `<{ }>`. This was done in the event templates are used in your HTML at runtime in the browser so that there are not conflictions when CloudForge compiles.

To learn more about how to use templates, please see <a href="http://olado.github.io/doT/index.html">doT.js</a>.

** Templates ** are an awesome part of CloudForge.


## HTML Directory Structure & metadata.json

Because of the nature of web page navigation for websites hosted on S3 buckets, we recommend conforming to the following directory structure for your source html, which will be the same for your resulting build directories html.

    .
    ├── ...
    ├── page1                    
    │   ├── index.html            # This would be mysite.com/page1     
    │   └── metadata.json
    ├── contact    
    │   ├── form-page
    │   │   ├── index.html        # This would be mysite.com/contact/form-page
    │   │   └── metadata.json
    │   ├── index.html            # This would be mysite.com/contact     
    │   ├── metadata.json
    │   └── template.html.dot     # This template will be used by all index.html files at this directory level and children.
    ├── index.html                # Top level landing page
    ├── metadata.json
    ├── template.html.dot         # This is the template all index.html files will be rendered in and unless another template.html.dot file is encountered in a child directory - in which case, index.html file in that directory and children directory will use the deeper template.html.dot file. 
    └── ...
    
For each directory containing an index.html file, you can also include a metadata.json file. This file is a JSON object with properties you specify. These properties are available through templating in template.html.dot files, and index.html files by using `<{ it.metadata }>`. To learn more about templating syntax please see the section above called "**Using Templating & Templates**".
    
## Sass

There are no unusual conventions associated with CloudForge and Sass. Also note, as expected - CloudForge will only render .scss and .sass files that **do not** begin with `_`. For example `_theme.scss` would **not** be rendered in the build directory at all.

Also, as expected, all compiled sass output will have the extension `.css`.
    
## Support

If you have any issues, feature requests or complaints, please <a href="https://github.com/Fanapptic/cloudforge/issues/new">open a new issue</a>. We'll do our best to quickly respond.
