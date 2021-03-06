/**
 * @ngdoc controller
 * @name Umbraco.Editors.Content.EditController
 * @function
 * 
 * @description
 * The controller for the content editor
 */
function ContentEditController($scope, $rootScope, $routeParams, $q, $timeout, $window, appState, contentResource, entityResource, navigationService, notificationsService, angularHelper, serverValidationManager, contentEditingHelper, treeService, fileManager, formHelper, umbRequestHelper, keyboardService, umbModelMapper, editorState, $http) {

    //setup scope vars
    $scope.defaultButton = null;
    $scope.subButtons = [];

    $scope.page = {};
    $scope.page.loading = false;
    $scope.page.menu = {};
    $scope.page.menu.currentNode = null;
    $scope.page.menu.currentSection = appState.getSectionState("currentSection");
    $scope.page.listViewPath = null;
    $scope.page.isNew = $routeParams.create;
    $scope.page.buttonGroupState = "init";

    function init(content) {

        var buttons = contentEditingHelper.configureContentEditorButtons({
            create: $routeParams.create,
            content: content,
            methods: {
                saveAndPublish: $scope.saveAndPublish,
                sendToPublish: $scope.sendToPublish,
                save: $scope.save,
                unPublish: $scope.unPublish
            }
        });
        $scope.defaultButton = buttons.defaultButton;
        $scope.subButtons = buttons.subButtons;

        editorState.set($scope.content);

        //We fetch all ancestors of the node to generate the footer breadcrumb navigation
        if (!$routeParams.create) {
            if (content.parentId && content.parentId != -1) {
                entityResource.getAncestors(content.id, "document")
               .then(function (anc) {
                   $scope.ancestors = anc;
               });
            }
        }
    }

    /** Syncs the content item to it's tree node - this occurs on first load and after saving */
    function syncTreeNode(content, path, initialLoad) {

        if (!$scope.content.isChildOfListView) {
            navigationService.syncTree({ tree: "content", path: path.split(","), forceReload: initialLoad !== true }).then(function (syncArgs) {
                $scope.page.menu.currentNode = syncArgs.node;
            });
        }
        else if (initialLoad === true) {

            //it's a child item, just sync the ui node to the parent
            navigationService.syncTree({ tree: "content", path: path.substring(0, path.lastIndexOf(",")).split(","), forceReload: initialLoad !== true });
            
            //if this is a child of a list view and it's the initial load of the editor, we need to get the tree node 
            // from the server so that we can load in the actions menu.
            umbRequestHelper.resourcePromise(
                $http.get(content.treeNodeUrl),
                'Failed to retrieve data for child node ' + content.id).then(function (node) {
                    $scope.page.menu.currentNode = node;
                });
        }
    }

    // This is a helper method to reduce the amount of code repitition for actions: Save, Publish, SendToPublish
    function performSave(args) {
        var deferred = $q.defer();

        $scope.page.buttonGroupState = "busy";

        contentEditingHelper.contentEditorPerformSave({
            statusMessage: args.statusMessage,
            saveMethod: args.saveMethod,
            scope: $scope,
            content: $scope.content,
            action: args.action
        }).then(function (data) {
            //success            
            init($scope.content);
            syncTreeNode($scope.content, data.path);

            $scope.page.buttonGroupState = "success";

            deferred.resolve(data);
        }, function (err) {
            //error
            if (err) {
                editorState.set($scope.content);
            }

            $scope.page.buttonGroupState = "error";

            deferred.reject(err);
        });

        return deferred.promise;
    }

    function resetLastListPageNumber(content) {
        // We're using rootScope to store the page number for list views, so if returning to the list
        // we can restore the page.  If we've moved on to edit a piece of content that's not the list or it's children
        // we should remove this so as not to confuse if navigating to a different list
        if (!content.isChildOfListView && !content.isContainer) {
            $rootScope.lastListViewPageViewed = null;
        }
    }

    if ($routeParams.create) {

      $scope.page.loading = true;

        //we are creating so get an empty content item
        contentResource.getScaffold($routeParams.id, $routeParams.doctype)
            .then(function (data) {

                $scope.content = data;

                init($scope.content);                

                resetLastListPageNumber($scope.content);

                $scope.page.loading = false;

            });
    }
    else {

        $scope.page.loading = true;

        //we are editing so get the content item from the server
        contentResource.getById($routeParams.id)
            .then(function (data) {

                $scope.content = data;

                if (data.isChildOfListView && data.trashed === false) {
                    $scope.page.listViewPath = ($routeParams.page)
                        ? "/content/content/edit/" + data.parentId + "?page=" + $routeParams.page
                        : "/content/content/edit/" + data.parentId;
                }

                init($scope.content);

                //in one particular special case, after we've created a new item we redirect back to the edit
                // route but there might be server validation errors in the collection which we need to display
                // after the redirect, so we will bind all subscriptions which will show the server validation errors
                // if there are any and then clear them so the collection no longer persists them.
                serverValidationManager.executeAndClearAllSubscriptions();

                syncTreeNode($scope.content, data.path, true);

                resetLastListPageNumber($scope.content);

                $scope.page.loading = false;

            });
    }


    $scope.unPublish = function () {

        if (formHelper.submitForm({ scope: $scope, statusMessage: "Unpublishing...", skipValidation: true })) {

           $scope.page.buttonGroupState = "busy";

            contentResource.unPublish($scope.content.id)
                .then(function (data) {

                    formHelper.resetForm({ scope: $scope, notifications: data.notifications });

                    contentEditingHelper.handleSuccessfulSave({
                        scope: $scope,
                        savedContent: data,
                        rebindCallback: contentEditingHelper.reBindChangedProperties($scope.content, data)
                    });

                    init($scope.content);

                    syncTreeNode($scope.content, data.path);

                    $scope.page.buttonGroupState = "success";

                });
        }

    };

    $scope.sendToPublish = function () {
        return performSave({ saveMethod: contentResource.sendToPublish, statusMessage: "Sending...", action: "sendToPublish" });
    };

    $scope.saveAndPublish = function () {
        return performSave({ saveMethod: contentResource.publish, statusMessage: "Publishing...", action: "publish" });
    };

    $scope.save = function () {
        return performSave({ saveMethod: contentResource.save, statusMessage: "Saving...", action: "save" });
    };

    $scope.preview = function (content) {


        if (!$scope.busy) {

            // Chromes popup blocker will kick in if a window is opened 
            // outwith the initial scoped request. This trick will fix that.
            //  
            var previewWindow = $window.open('preview/?id=' + content.id, 'umbpreview');
            $scope.save().then(function (data) {
                // Build the correct path so both /#/ and #/ work.
                var redirect = Umbraco.Sys.ServerVariables.umbracoSettings.umbracoPath + '/preview/?id=' + data.id;
                previewWindow.location.href = redirect;
            });


        }

    };

}

angular.module("umbraco").controller("Umbraco.Editors.Content.EditController", ContentEditController);
